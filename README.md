# Projet 4 — Traitement d'images par modele variationnel TV

Debruitage et inpainting d'images par variation totale (modele de
Rudin-Osher-Fatemi), avec comparaison au filtre gaussien classique.
Relie calcul variationnel, optimisation convexe et vision par ordinateur.

**Site en ligne : https://math-projet.vercel.app**

---

## 1. Ce qui a ete fait

| Couche | Techno | Repertoire | Heberge sur |
|---|---|---|---|
| Algorithmes + API REST | Python, FastAPI, NumPy/SciPy | [`projet4_tv/`](projet4_tv/) | Render |
| Interface web | Next.js (TypeScript, Tailwind) | [`frontend/`](frontend/) | Vercel |

Le coeur mathematique (`projet4_tv/app.py`) implemente :

- les operateurs discrets **gradient** et **divergence** (adjoints, conditions de Neumann) ;
- le **debruitage TV** par l'algorithme de projection duale de Chambolle, qui resout
  `min_u 1/2||u-f||^2 + lambda*TV(u)` sans jamais diviser par `|grad u| = 0` ;
- l'**inpainting TV**, meme principe avec un terme de fidelite restreint aux pixels connus (masque) ;
- le **filtre gaussien** comme reference de comparaison (diffusion isotrope, par opposition
  a la diffusion anisotrope de la TV qui preserve les contours) ;
- les metriques **PSNR** et **variation totale**.

La derivation theorique complete (variation totale, equation d'Euler-Lagrange, existence
du minimiseur dans BV(Omega)) est documentee dans le docstring en tete de
[`projet4_tv/app.py`](projet4_tv/app.py).

Ces algorithmes sont exposes en HTTP via FastAPI, et consommes par une interface Next.js
qui permet d'uploader une image, dessiner un masque au pinceau, lancer les traitements et
visualiser les resultats avec leurs metriques.

---

## 2. Tester le site en ligne

Va sur **https://math-projet.vercel.app** et essaie, dans l'ordre :

1. **Demonstration** — clique sur "Generer" puis "Lancer la demo" (debruitage et inpainting).
   Aucun fichier a fournir : tout est genere cote serveur (image synthetique carre + disque,
   bruit gaussien ajoute automatiquement). C'est le moyen le plus rapide de voir que tout
   fonctionne de bout en bout.
2. **Debruitage** — uploade une image (de preference avec du bruit visible), choisis
   "Variation totale" ou "Filtre gaussien", ajuste `lambda`/iterations ou `sigma`, puis
   "Debruiter". Compare le resultat et regarde la variation totale (TV) affichee : plus
   elle est basse, plus l'image est lissee.
3. **Inpainting** — uploade une image, peins au pinceau (clic-glisse) la zone a faire
   disparaitre/reconstruire, ajuste la taille du pinceau, puis "Reconstruire". Le masque
   (blanc = zone a reconstruire) est genere automatiquement a partir du trace, pas besoin
   de fournir un second fichier.
4. **Comparaison** — uploade une image bruitee et, si tu l'as, l'image propre d'origine en
   "Reference" : tu obtiens alors le PSNR du debruitage TV vs gaussien cote a cote, en plus
   de l'image composite.

**Note sur le demarrage a froid (cold start) :** le backend est sur le plan gratuit de
Render, qui met le service en veille apres une periode d'inactivite. Le premier appel
peut donc prendre 30 a 50 secondes avant de repondre — c'est normal, pas un bug. Le point
de statut en haut de la page ("en ligne" / "hors ligne" / "verification...") permet de
suivre l'etat de l'API ; tu peux aussi cliquer dessus pour relancer la verification.

### Tester directement l'API (sans interface)

L'API a sa propre documentation interactive (Swagger), generee automatiquement par
FastAPI :

**https://mathprojet.onrender.com/docs**

Tu peux y essayer chaque endpoint a la main (upload de fichier, parametres, execution),
voir le schema exact des requetes/reponses, sans passer par le frontend.

Endpoints disponibles :

| Methode | Endpoint | Description |
|---|---|---|
| GET | `/health` | Etat de l'API |
| GET | `/demo/test-image` | Image synthetique de test |
| GET | `/demo/denoising` | Demo complete de debruitage (sans upload) |
| GET | `/demo/inpainting` | Demo complete d'inpainting (sans upload) |
| POST | `/denoise/tv` | Debruitage TV sur une image uploadee |
| POST | `/denoise/gaussian` | Debruitage gaussien sur une image uploadee |
| POST | `/inpaint` | Inpainting TV (image + masque uploades) |
| POST | `/compare` | Comparaison TV vs gaussien (+ PSNR si reference fournie) |

Les metriques (PSNR, variation totale) sont renvoyees dans les en-tetes HTTP de la
reponse (`X-PSNR-*`, `X-TV-*`), visibles dans l'onglet Network du navigateur ou dans la
reponse Swagger.

---

## 3. Comment le site fonctionne (architecture)

```
Navigateur ── (fetch / upload) ──> Frontend Next.js (Vercel)
                                         │
                                         │  appels HTTP directs, cross-origin
                                         ▼
                              API FastAPI (Render) ── NumPy/SciPy ── algorithmes TV
```

- Le **frontend** est une application Next.js statique (une seule page, App Router),
  hebergee sur Vercel. Elle ne fait aucun calcul elle-meme : chaque action (generer,
  debruiter, reconstruire, comparer) declenche un appel `fetch` direct vers l'API FastAPI,
  avec l'image (et le masque, pour l'inpainting) envoyee en `multipart/form-data`.
- Le **backend** (Render) recoit l'image, la convertit en tableau NumPy, applique
  l'algorithme demande, et renvoie le resultat en PNG. Les metriques sont glissees dans
  des en-tetes HTTP personnalises plutot que dans le corps, pour garder une reponse image
  directement affichable (`<img src="...">`).
- Les deux services sont sur des domaines differents (`vercel.app` et `onrender.com`),
  d'ou la necessite du **CORS** (`Access-Control-Allow-Origin: *` et
  `Access-Control-Expose-Headers: *`) cote API pour que le navigateur autorise l'appel et
  que le JavaScript puisse lire les en-tetes de metriques.
- L'URL de l'API est configurable depuis le champ en haut de l'interface (et via la
  variable d'environnement `NEXT_PUBLIC_API_URL` au build) — utile pour pointer vers une
  API locale pendant le developpement.

---

## 4. Lancer le projet en local

### Backend

```bash
cd projet4_tv
./run.sh
```

Installe les dependances si besoin et demarre l'API sur `http://localhost:8000`
(documentation interactive sur `http://localhost:8000/docs`).

Le script de demonstration (`python app.py`, sans serveur) genere directement les figures
du rapport (`denoising_comparison.png`, `inpainting_result.png`).

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Ouvre `http://localhost:3000`. Par defaut l'interface pointe vers l'API de production
(`https://mathprojet.onrender.com`) ; pour la faire pointer vers le backend local, cree un
fichier `.env.local` (voir `.env.example`) :

```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

ou modifie directement le champ "API" en haut de la page.

---

## 5. Deploiement

- **Backend → Render** : configure via [`render.yaml`](render.yaml) (Blueprint) ou
  manuellement avec Root Directory `projet4_tv`, build `pip install -r requirements.txt`,
  start `uvicorn app:app --host 0.0.0.0 --port $PORT`. La version Python est fixee a
  `3.12.3` par [`projet4_tv/.python-version`](projet4_tv/.python-version) (necessaire car
  SciPy n'a pas de wheel precompile pour les versions Python trop recentes).
- **Frontend → Vercel** : Root Directory `frontend`, framework Next.js detecte
  automatiquement, variable d'environnement `NEXT_PUBLIC_API_URL` pointant vers l'URL
  Render.

Le depot exclut volontairement les fichiers `*.pdf` et `*.txt` (sujet du projet) du suivi
git (voir [`.gitignore`](.gitignore)).

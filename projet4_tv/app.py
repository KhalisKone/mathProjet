"""
================================================================================
PROJET 4 : Traitement d'images par modele variationnel TV (Rudin-Osher-Fatemi)
================================================================================

Objectif : relier optimisation, calcul variationnel et vision par ordinateur.

--------------------------------------------------------------------------
PARTIE THEORIQUE
--------------------------------------------------------------------------

Modele de Rudin-Osher-Fatemi (ROF) :

    E(u) = 1/2 * ||u - f||_2^2 + lambda * TV(u)

ou f est l'image bruitee, u l'image recherchee, lambda > 0 le poids de
regularisation.

1) Variation totale
   Version continue :  TV(u) = integrale_Omega |grad u| dx
   Version discrete (utilisee dans le code) :
        TV(u) = somme_{i,j} sqrt( (D_x u)_{i,j}^2 + (D_y u)_{i,j}^2 )
   avec D_x, D_y les differences finies avant (cf. grad()). La TV penalise
   les oscillations (bruit) mais autorise les discontinuites nettes
   (contours), contrairement a une penalisation quadratique ||grad u||^2
   (Tikhonov) qui lisse aussi les contours.

2) Equation d'Euler-Lagrange
   La derivee de Gateaux de E en u, dans la direction v, s'annule pour
   tout v :
        < u - f, v > + lambda * < grad u / |grad u| , grad v > = 0
   Par integration par parties (div = -grad^T) :
        < u - f, v > - lambda * < div( grad u / |grad u| ), v > = 0  pour tout v
   D'ou, formellement (|grad u| != 0) :

        u - f = lambda * div( grad u / |grad u| )

   div(grad u / |grad u|) est la courbure des lignes de niveau (curvature
   flow) : diffusion anisotrope, tangentielle aux contours seulement -> les
   bords sont preserves (contrairement au filtre gaussien = diffusion
   isotrope, equivalent a l'equation de la chaleur).

3) Existence d'un minimiseur
   TV(.) est convexe (norme composee avec un operateur lineaire) mais non
   strictement convexe ni differentiable en |grad u| = 0. Le terme
   1/2||u-f||^2 est strictement convexe et coercif. La somme est donc
   convexe, coercive, et semi-continue inferieurement pour la topologie
   faible-* de BV(Omega) (fonctions a variation bornee). Par la methode
   directe du calcul des variations (compacite + s.c.i.), un minimiseur
   existe ; il est unique par stricte convexite du terme quadratique.

--------------------------------------------------------------------------
PARTIE PRATIQUE
--------------------------------------------------------------------------
- grad / div         : operateurs discrets adjoints (Neumann au bord)
- tv_denoise         : debruitage TV via l'algorithme de projection duale
                       de Chambolle (resout le probleme dual de ROF, evite
                       de diviser par |grad u| = 0)
- tv_inpaint         : meme schema, terme de fidelite restreint aux pixels
                       connus (masque), reconstruit les pixels manquants
                       par propagation des contours
- gaussian_denoise   : filtre gaussien (comparaison, diffusion isotrope)
- API REST (FastAPI) : expose ces algorithmes en endpoints HTTP pour un
                       futur frontend (upload d'image -> image traitee)

Application IA : pretraitement d'images (debruitage / inpainting) avant
segmentation par reseau de neurones.

--------------------------------------------------------------------------
UTILISATION
--------------------------------------------------------------------------
1) Generer les figures du rapport (sans serveur) :
       python app.py
   -> produit denoising_comparison.png et inpainting_result.png

2) Lancer l'API pour un frontend :
       uvicorn app:app --reload --port 8000
   -> documentation interactive : http://localhost:8000/docs
================================================================================
"""
from __future__ import annotations

import io

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from PIL import Image
from scipy.ndimage import gaussian_filter


# ============================================================================
# 1. OPERATEURS DISCRETS
# ============================================================================

def grad(u: np.ndarray) -> np.ndarray:
    """Gradient discret (differences avant, conditions de Neumann)."""
    gx = np.zeros_like(u)
    gy = np.zeros_like(u)
    gx[:, :-1] = u[:, 1:] - u[:, :-1]
    gy[:-1, :] = u[1:, :] - u[:-1, :]
    return np.stack([gx, gy])


def div(p: np.ndarray) -> np.ndarray:
    """Divergence discrete = -(gradient)^T (operateur adjoint de grad)."""
    px, py = p[0], p[1]
    dx = np.zeros_like(px)
    dy = np.zeros_like(py)
    dx[:, 0] = px[:, 0]
    dx[:, 1:-1] = px[:, 1:-1] - px[:, :-2]
    dx[:, -1] = -px[:, -2]
    dy[0, :] = py[0, :]
    dy[1:-1, :] = py[1:-1, :] - py[:-2, :]
    dy[-1, :] = -py[-2, :]
    return dx + dy


def total_variation(u: np.ndarray) -> float:
    """TV(u) = somme ||grad u|| (norme discrete utilisee dans E(u))."""
    gu = grad(u)
    return float(np.sum(np.sqrt(gu[0] ** 2 + gu[1] ** 2)))


# ============================================================================
# 2. DEBRUITAGE TV (algorithme de projection duale de Chambolle)
# ============================================================================

def tv_denoise(f: np.ndarray, lam: float = 0.1, n_iter: int = 200, tau: float = 0.25) -> np.ndarray:
    """
    Resout min_u 1/2||u-f||^2 + lam*TV(u) en travaillant sur la variable
    duale p (champ vectoriel), ce qui evite la singularite de
    grad u / |grad u| quand grad u = 0.
    """
    p = np.zeros((2,) + f.shape)
    for _ in range(n_iter):
        u = f + lam * div(p)
        gu = grad(u)
        norm = np.sqrt(gu[0] ** 2 + gu[1] ** 2)
        denom = 1.0 + tau * norm / lam
        p = (p + tau * gu / lam) / denom
    return f + lam * div(p)


# ============================================================================
# 3. INPAINTING TV
# ============================================================================

def tv_inpaint(f: np.ndarray, mask: np.ndarray, lam: float = 0.0, n_iter: int = 300, tau: float = 0.25) -> np.ndarray:
    """
    Reconstruit les pixels ou mask == False en minimisant TV(u) sous
    contrainte de fidelite u = f sur mask == True (lam=0 -> contrainte
    stricte ; lam>0 -> fidelite souple, utile si f est aussi bruite).
    """
    u = f.copy()
    p = np.zeros((2,) + f.shape)
    for _ in range(n_iter):
        div_p = div(p)
        u = np.where(mask, f + lam * div_p, u + tau * div_p)
        gu = grad(u)
        norm = np.sqrt(gu[0] ** 2 + gu[1] ** 2)
        denom = 1.0 + tau * norm
        p = (p + tau * gu) / denom
    return u


# ============================================================================
# 4. COMPARAISON : filtre gaussien (diffusion isotrope)
# ============================================================================

def gaussian_denoise(f: np.ndarray, sigma: float = 1.5) -> np.ndarray:
    return gaussian_filter(f, sigma=sigma)


# ============================================================================
# 5. UTILITAIRES
# ============================================================================

def make_test_image(n: int = 128) -> np.ndarray:
    """Image synthetique : carre + disque, contours nets (favorable a la TV)."""
    img = np.zeros((n, n))
    img[n // 4: 3 * n // 4, n // 4: 3 * n // 4] = 0.6
    yy, xx = np.mgrid[0:n, 0:n]
    cy, cx, r = n // 2, n // 2, n // 6
    disk = (yy - cy) ** 2 + (xx - cx) ** 2 <= r ** 2
    img[disk] = 1.0
    return img


def psnr(ref: np.ndarray, test: np.ndarray) -> float:
    mse = np.mean((ref - test) ** 2)
    return float(10 * np.log10(1.0 / mse)) if mse > 0 else float("inf")


# ============================================================================
# 6. API REST (FastAPI) - pour un futur frontend
# ============================================================================

app = FastAPI(
    title="API Projet 4 - Modele variationnel TV (ROF)",
    description=(
        "Debruitage et inpainting d'images par variation totale "
        "(Rudin-Osher-Fatemi), avec comparaison au filtre gaussien."
    ),
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


async def _load_grayscale(upload: UploadFile) -> np.ndarray:
    """Charge un fichier image uploade en tableau float64 [0, 1] en niveaux de gris."""
    raw = await upload.read()
    try:
        img = Image.open(io.BytesIO(raw)).convert("L")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Image invalide : {exc}") from exc
    return np.asarray(img, dtype=np.float64) / 255.0


def _to_png_bytes(arr: np.ndarray) -> bytes:
    """Convertit un tableau float [0, 1] en PNG 8 bits encode en memoire."""
    clipped = np.clip(arr, 0.0, 1.0)
    img = Image.fromarray((clipped * 255).astype(np.uint8), mode="L")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _png_response(arr: np.ndarray, headers: dict[str, str] | None = None) -> Response:
    return Response(
        content=_to_png_bytes(arr),
        media_type="image/png",
        headers={k: str(v) for k, v in (headers or {}).items()},
    )


def _hstack(*arrays: np.ndarray) -> np.ndarray:
    """Concatene plusieurs images de meme hauteur cote a cote, separees par une bande blanche."""
    h = arrays[0].shape[0]
    sep = np.ones((h, 4))
    parts = []
    for i, a in enumerate(arrays):
        if i > 0:
            parts.append(sep)
        parts.append(a)
    return np.hstack(parts)


@app.get("/health", summary="Verifie que l'API repond")
def health() -> dict:
    return {"status": "ok"}


@app.get(
    "/demo/test-image",
    summary="Image synthetique de test (carre + disque, contours nets)",
    response_class=Response,
)
def demo_test_image(n: int = Query(128, ge=16, le=1024)) -> Response:
    return _png_response(make_test_image(n))


@app.post(
    "/denoise/tv",
    summary="Debruitage par variation totale (algorithme de Chambolle)",
    response_class=Response,
)
async def denoise_tv(
    file: UploadFile = File(..., description="Image a debruiter"),
    lam: float = Query(0.12, gt=0, description="Poids de regularisation lambda"),
    n_iter: int = Query(200, ge=1, le=2000, description="Nombre d'iterations"),
) -> Response:
    f = await _load_grayscale(file)
    u = tv_denoise(f, lam=lam, n_iter=n_iter)
    return _png_response(u, headers={"X-TV-Output": f"{total_variation(u):.4f}"})


@app.post(
    "/denoise/gaussian",
    summary="Debruitage par filtre gaussien (reference de comparaison)",
    response_class=Response,
)
async def denoise_gaussian(
    file: UploadFile = File(..., description="Image a debruiter"),
    sigma: float = Query(1.5, gt=0, description="Ecart-type du noyau gaussien"),
) -> Response:
    f = await _load_grayscale(file)
    u = gaussian_denoise(f, sigma=sigma)
    return _png_response(u, headers={"X-TV-Output": f"{total_variation(u):.4f}"})


@app.post(
    "/inpaint",
    summary="Inpainting TV : reconstruit les zones masquees d'une image",
    response_class=Response,
)
async def inpaint(
    file: UploadFile = File(..., description="Image a restaurer"),
    mask_file: UploadFile = File(
        ..., description="Masque noir/blanc : blanc = pixel a reconstruire, noir = pixel connu"
    ),
    lam: float = Query(0.0, ge=0, description="Fidelite sur les pixels connus (0 = contrainte stricte)"),
    n_iter: int = Query(300, ge=1, le=3000, description="Nombre d'iterations"),
) -> Response:
    f = await _load_grayscale(file)
    mask_raw = await _load_grayscale(mask_file)
    if mask_raw.shape != f.shape:
        raise HTTPException(
            status_code=400,
            detail=f"L'image ({f.shape}) et le masque ({mask_raw.shape}) doivent avoir la meme taille.",
        )
    known_mask = mask_raw < 0.5  # blanc (>=0.5) = zone a reconstruire
    u = tv_inpaint(f, known_mask, lam=lam, n_iter=n_iter)
    return _png_response(u, headers={"X-TV-Output": f"{total_variation(u):.4f}"})


@app.post(
    "/compare",
    summary="Compare debruitage TV vs gaussien (image cote a cote + metriques)",
    response_class=Response,
)
async def compare(
    file: UploadFile = File(..., description="Image bruitee a traiter"),
    reference_file: UploadFile | None = File(
        None, description="Image de reference propre, optionnelle (pour calculer le PSNR)"
    ),
    lam: float = Query(0.12, gt=0),
    n_iter: int = Query(200, ge=1, le=2000),
    sigma: float = Query(1.5, gt=0),
) -> Response:
    noisy = await _load_grayscale(file)
    denoised_tv = tv_denoise(noisy, lam=lam, n_iter=n_iter)
    denoised_gauss = gaussian_denoise(noisy, sigma=sigma)

    headers = {
        "X-TV-Noisy": f"{total_variation(noisy):.4f}",
        "X-TV-Denoised-TV": f"{total_variation(denoised_tv):.4f}",
        "X-TV-Denoised-Gaussian": f"{total_variation(denoised_gauss):.4f}",
    }

    if reference_file is not None:
        ref = await _load_grayscale(reference_file)
        if ref.shape != noisy.shape:
            raise HTTPException(
                status_code=400,
                detail=f"L'image ({noisy.shape}) et la reference ({ref.shape}) doivent avoir la meme taille.",
            )
        headers["X-PSNR-Noisy"] = f"{psnr(ref, noisy):.4f}"
        headers["X-PSNR-TV"] = f"{psnr(ref, denoised_tv):.4f}"
        headers["X-PSNR-Gaussian"] = f"{psnr(ref, denoised_gauss):.4f}"

    composite = _hstack(noisy, denoised_tv, denoised_gauss)
    return _png_response(composite, headers=headers)


@app.get(
    "/demo/denoising",
    summary="Demo complete de debruitage sur image synthetique (sans upload)",
    response_class=Response,
)
def demo_denoising(
    n: int = Query(128, ge=16, le=512),
    noise_sigma: float = Query(0.15, ge=0, le=1),
    lam: float = Query(0.12, gt=0),
    n_iter: int = Query(200, ge=1, le=2000),
    sigma: float = Query(1.5, gt=0),
    seed: int = Query(0),
) -> Response:
    rng = np.random.default_rng(seed)
    clean = make_test_image(n)
    noisy = np.clip(clean + rng.normal(0, noise_sigma, clean.shape), 0, 1)
    denoised_tv = tv_denoise(noisy, lam=lam, n_iter=n_iter)
    denoised_gauss = gaussian_denoise(noisy, sigma=sigma)

    headers = {
        "X-PSNR-Noisy": f"{psnr(clean, noisy):.4f}",
        "X-PSNR-TV": f"{psnr(clean, denoised_tv):.4f}",
        "X-PSNR-Gaussian": f"{psnr(clean, denoised_gauss):.4f}",
        "X-TV-Noisy": f"{total_variation(noisy):.4f}",
        "X-TV-Denoised-TV": f"{total_variation(denoised_tv):.4f}",
        "X-TV-Denoised-Gaussian": f"{total_variation(denoised_gauss):.4f}",
    }
    composite = _hstack(clean, noisy, denoised_tv, denoised_gauss)
    return _png_response(composite, headers=headers)


@app.get(
    "/demo/inpainting",
    summary="Demo complete d'inpainting sur image synthetique (sans upload)",
    response_class=Response,
)
def demo_inpainting(
    n: int = Query(128, ge=16, le=512),
    band_height: int = Query(20, ge=1, le=100),
    lam: float = Query(0.0, ge=0),
    n_iter: int = Query(300, ge=1, le=3000),
) -> Response:
    clean = make_test_image(n)
    known_mask = np.ones_like(clean, dtype=bool)
    half = band_height // 2
    known_mask[n // 2 - half: n // 2 + half, :] = False
    corrupted = clean.copy()
    corrupted[~known_mask] = 0
    inpainted = tv_inpaint(corrupted, known_mask, lam=lam, n_iter=n_iter)

    headers = {"X-PSNR-Inpainted": f"{psnr(clean, inpainted):.4f}"}
    composite = _hstack(clean, corrupted, inpainted)
    return _png_response(composite, headers=headers)


# ============================================================================
# 7. SCRIPT AUTONOME (rapport / figures, sans lancer de serveur)
# ============================================================================

def _generate_report_figures() -> None:
    rng = np.random.default_rng(0)
    clean = make_test_image()
    noisy = np.clip(clean + rng.normal(0, 0.15, clean.shape), 0, 1)

    denoised_tv = tv_denoise(noisy, lam=0.12, n_iter=200)
    denoised_gauss = gaussian_denoise(noisy, sigma=1.5)

    print("=== Debruitage ===")
    print(f"PSNR bruite      : {psnr(clean, noisy):.2f} dB")
    print(f"PSNR TV          : {psnr(clean, denoised_tv):.2f} dB")
    print(f"PSNR gaussien    : {psnr(clean, denoised_gauss):.2f} dB")
    print(f"TV(image bruitee): {total_variation(noisy):.1f}")
    print(f"TV(debruite TV)  : {total_variation(denoised_tv):.1f}")
    print(f"TV(debruite gaus): {total_variation(denoised_gauss):.1f}")

    fig, axes = plt.subplots(1, 4, figsize=(16, 4))
    for ax, im, title in zip(
        axes,
        [clean, noisy, denoised_tv, denoised_gauss],
        ["Originale", "Bruitee", f"TV (PSNR={psnr(clean, denoised_tv):.1f}dB)",
         f"Gaussien (PSNR={psnr(clean, denoised_gauss):.1f}dB)"],
    ):
        ax.imshow(im, cmap="gray", vmin=0, vmax=1)
        ax.set_title(title)
        ax.axis("off")
    fig.tight_layout()
    fig.savefig("denoising_comparison.png", dpi=130)
    print("-> denoising_comparison.png")

    mask = np.ones_like(clean, dtype=bool)
    n = clean.shape[0]
    mask[n // 2 - 10: n // 2 + 10, :] = False
    corrupted = clean.copy()
    corrupted[~mask] = 0
    inpainted = tv_inpaint(corrupted, mask, lam=0.0, n_iter=300)

    print("\n=== Inpainting ===")
    print(f"PSNR reconstruction TV : {psnr(clean, inpainted):.2f} dB")

    fig2, axes2 = plt.subplots(1, 3, figsize=(12, 4))
    for ax, im, title in zip(
        axes2, [clean, corrupted, inpainted],
        ["Originale", "Avec trou (masque)", "Inpainting TV"]
    ):
        ax.imshow(im, cmap="gray", vmin=0, vmax=1)
        ax.set_title(title)
        ax.axis("off")
    fig2.tight_layout()
    fig2.savefig("inpainting_result.png", dpi=130)
    print("-> inpainting_result.png")


if __name__ == "__main__":
    _generate_report_figures()

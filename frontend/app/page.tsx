"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_API =
  process.env.NEXT_PUBLIC_API_URL || "https://mathprojet.onrender.com";

/* ============================================================================
 * Utilitaires API
 * ========================================================================== */

type Metrics = Record<string, string>;

const METRIC_LABELS: Record<string, string> = {
  "x-tv-output": "Variation totale (sortie)",
  "x-tv-noisy": "TV — image bruitee",
  "x-tv-denoised-tv": "TV — debruitage TV",
  "x-tv-denoised-gaussian": "TV — debruitage gaussien",
  "x-psnr-noisy": "PSNR — image bruitee",
  "x-psnr-tv": "PSNR — debruitage TV",
  "x-psnr-gaussian": "PSNR — debruitage gaussien",
  "x-psnr-inpainted": "PSNR — reconstruction",
};

function extractMetrics(headers: Headers): Metrics {
  const out: Metrics = {};
  headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (k in METRIC_LABELS) out[k] = value;
  });
  return out;
}

async function apiRequest(
  base: string,
  path: string,
  init?: RequestInit
): Promise<{ blob: Blob; metrics: Metrics }> {
  const res = await fetch(`${base}${path}`, init);
  if (!res.ok) {
    let detail = `Erreur HTTP ${res.status}`;
    try {
      const data = await res.json();
      if (data?.detail) detail = data.detail;
    } catch {
      /* corps non-JSON, on garde le message generique */
    }
    throw new Error(detail);
  }
  const blob = await res.blob();
  return { blob, metrics: extractMetrics(res.headers) };
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Echec d'export du canvas"));
    }, "image/png");
  });
}

function useObjectUrl() {
  const [url, setUrl] = useState<string | null>(null);
  const set = useCallback((blob: Blob | null) => {
    setUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return blob ? URL.createObjectURL(blob) : null;
    });
  }, []);
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);
  return [url, set] as const;
}

/* ============================================================================
 * Composants generiques
 * ========================================================================== */

function SectionHeading({
  index,
  title,
  description,
}: {
  index: string;
  title: string;
  description: string;
}) {
  return (
    <div className="mb-10 flex flex-col gap-3 border-b border-black pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <span className="font-mono text-xs tracking-widest text-neutral-500">
          {index}
        </span>
        <h2 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">
          {title}
        </h2>
      </div>
      <p className="max-w-md text-sm leading-relaxed text-neutral-600">
        {description}
      </p>
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
  step = 1,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-mono text-[11px] uppercase tracking-wider text-neutral-500">
        {label}
      </span>
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (!Number.isNaN(v)) onChange(v);
        }}
        className="w-full border-b border-neutral-300 bg-transparent py-1.5 font-mono text-sm focus:border-black focus:outline-none"
      />
    </label>
  );
}

function Button({
  children,
  onClick,
  disabled,
  variant = "primary",
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary";
  type?: "button" | "submit";
}) {
  const base =
    "inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-medium tracking-wide transition-colors disabled:cursor-not-allowed disabled:opacity-40";
  const styles =
    variant === "primary"
      ? "bg-black text-white hover:bg-neutral-800"
      : "border border-black bg-white text-black hover:bg-black hover:text-white";
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${styles}`}
    >
      {children}
    </button>
  );
}

function MetricsGrid({ metrics }: { metrics: Metrics | null }) {
  if (!metrics || Object.keys(metrics).length === 0) return null;
  return (
    <dl className="mt-6 grid grid-cols-1 gap-px overflow-hidden border border-neutral-200 sm:grid-cols-2">
      {Object.entries(metrics).map(([key, value]) => (
        <div
          key={key}
          className="flex items-center justify-between gap-4 bg-neutral-50 px-4 py-3"
        >
          <dt className="text-xs uppercase tracking-wide text-neutral-500">
            {METRIC_LABELS[key] || key}
          </dt>
          <dd className="font-mono text-sm font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ImageFrame({
  src,
  placeholder,
}: {
  src: string | null;
  placeholder: string;
}) {
  return (
    <div className="flex aspect-square w-full items-center justify-center border border-neutral-200 bg-neutral-50">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="max-h-full max-w-full object-contain" />
      ) : (
        <span className="px-4 text-center font-mono text-xs text-neutral-400">
          {placeholder}
        </span>
      )}
    </div>
  );
}

function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="mt-4 border border-black bg-neutral-50 px-4 py-3 font-mono text-xs text-black">
      {message}
    </p>
  );
}

/* ============================================================================
 * Page
 * ========================================================================== */

export default function Page() {
  const [apiBase, setApiBase] = useState(DEFAULT_API);
  const [apiStatus, setApiStatus] = useState<"idle" | "online" | "offline" | "checking">(
    "idle"
  );

  const checkHealth = useCallback(async (base: string) => {
    setApiStatus("checking");
    try {
      const res = await fetch(`${base}/health`, { cache: "no-store" });
      setApiStatus(res.ok ? "online" : "offline");
    } catch {
      setApiStatus("offline");
    }
  }, []);

  useEffect(() => {
    checkHealth(apiBase);
  }, [apiBase, checkHealth]);

  return (
    <div className="min-h-screen bg-white text-black">
      <TopBar
        apiBase={apiBase}
        setApiBase={setApiBase}
        apiStatus={apiStatus}
        onRefresh={() => checkHealth(apiBase)}
      />
      <Hero />
      <main className="mx-auto max-w-5xl px-6 pb-28 sm:px-10">
        <DemoSection apiBase={apiBase} />
        <DenoiseSection apiBase={apiBase} />
        <InpaintSection apiBase={apiBase} />
        <CompareSection apiBase={apiBase} />
      </main>
      <Footer />
    </div>
  );
}

/* ----------------------------- Top bar ----------------------------------- */

function TopBar({
  apiBase,
  setApiBase,
  apiStatus,
  onRefresh,
}: {
  apiBase: string;
  setApiBase: (v: string) => void;
  apiStatus: "idle" | "online" | "offline" | "checking";
  onRefresh: () => void;
}) {
  const dotColor =
    apiStatus === "online"
      ? "bg-black"
      : apiStatus === "checking"
      ? "bg-neutral-400 animate-pulse"
      : apiStatus === "offline"
      ? "bg-white border border-black"
      : "bg-neutral-300";

  const statusText: Record<typeof apiStatus, string> = {
    idle: "non verifie",
    checking: "verification...",
    online: "en ligne",
    offline: "hors ligne",
  };

  return (
    <div className="sticky top-0 z-30 border-b border-black bg-white">
      <div className="mx-auto flex max-w-5xl flex-col gap-3 px-6 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-10">
        <nav className="flex gap-5 overflow-x-auto font-mono text-xs uppercase tracking-wider text-neutral-600 no-scrollbar">
          <a href="#demo" className="whitespace-nowrap hover:text-black">
            Demonstration
          </a>
          <a href="#denoise" className="whitespace-nowrap hover:text-black">
            Debruitage
          </a>
          <a href="#inpaint" className="whitespace-nowrap hover:text-black">
            Inpainting
          </a>
          <a href="#compare" className="whitespace-nowrap hover:text-black">
            Comparaison
          </a>
        </nav>
        <div className="flex items-center gap-3">
          <input
            value={apiBase}
            onChange={(e) => setApiBase(e.target.value)}
            spellCheck={false}
            className="w-56 border-b border-neutral-300 bg-transparent py-1 font-mono text-xs focus:border-black focus:outline-none"
          />
          <button
            onClick={onRefresh}
            className="flex items-center gap-2 font-mono text-xs text-neutral-600 hover:text-black"
          >
            <span className={`h-2 w-2 rounded-full ${dotColor}`} />
            {statusText[apiStatus]}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------- Hero -------------------------------------*/

function Hero() {
  return (
    <header className="border-b border-black px-6 py-20 sm:px-10 sm:py-28">
      <div className="mx-auto max-w-5xl">
        <p className="font-mono text-xs uppercase tracking-widest text-neutral-500">
          Projet 4 — Calcul variationnel &amp; vision par ordinateur
        </p>
        <h1 className="mt-4 max-w-3xl text-5xl font-semibold leading-[1.05] tracking-tightest sm:text-7xl">
          Modele variationnel TV
        </h1>
        <p className="mt-6 max-w-2xl text-base leading-relaxed text-neutral-600 sm:text-lg">
          Debruitage et inpainting d&apos;images par variation totale, modele
          de Rudin-Osher-Fatemi. Cette interface appelle directement
          l&apos;API de traitement d&apos;image et compare les resultats au
          filtre gaussien classique.
        </p>
        <div className="mt-10 inline-block border border-neutral-300 bg-neutral-50 px-6 py-4 font-mono text-sm">
          E(u) = 1/2 &middot; ||u &minus; f||&sup2; + &lambda; &middot; TV(u)
        </div>
      </div>
    </header>
  );
}

/* ------------------------------ Demo --------------------------------------*/

function DemoSection({ apiBase }: { apiBase: string }) {
  const [testN, setTestN] = useState(128);
  const [testUrl, setTestUrl] = useObjectUrl();
  const [testLoading, setTestLoading] = useState(false);

  const [ddParams, setDdParams] = useState({
    n: 128,
    noise_sigma: 0.15,
    lam: 0.12,
    n_iter: 200,
    sigma: 1.5,
    seed: 0,
  });
  const [ddUrl, setDdUrl] = useObjectUrl();
  const [ddMetrics, setDdMetrics] = useState<Metrics | null>(null);
  const [ddLoading, setDdLoading] = useState(false);

  const [diParams, setDiParams] = useState({
    n: 128,
    band_height: 20,
    lam: 0,
    n_iter: 300,
  });
  const [diUrl, setDiUrl] = useObjectUrl();
  const [diMetrics, setDiMetrics] = useState<Metrics | null>(null);
  const [diLoading, setDiLoading] = useState(false);

  const [error, setError] = useState<string | null>(null);

  async function runTestImage() {
    setTestLoading(true);
    setError(null);
    try {
      const { blob } = await apiRequest(apiBase, `/demo/test-image?n=${testN}`);
      setTestUrl(blob);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTestLoading(false);
    }
  }

  async function runDemoDenoising() {
    setDdLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams(
        Object.fromEntries(
          Object.entries(ddParams).map(([k, v]) => [k, String(v)])
        )
      );
      const { blob, metrics } = await apiRequest(
        apiBase,
        `/demo/denoising?${qs.toString()}`
      );
      setDdUrl(blob);
      setDdMetrics(metrics);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDdLoading(false);
    }
  }

  async function runDemoInpainting() {
    setDiLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams(
        Object.fromEntries(
          Object.entries(diParams).map(([k, v]) => [k, String(v)])
        )
      );
      const { blob, metrics } = await apiRequest(
        apiBase,
        `/demo/inpainting?${qs.toString()}`
      );
      setDiUrl(blob);
      setDiMetrics(metrics);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDiLoading(false);
    }
  }

  return (
    <section id="demo" className="pt-24">
      <SectionHeading
        index="01"
        title="Demonstration"
        description="Aucun upload requis : ces appels generent une image synthetique cote serveur et renvoient directement le resultat."
      />

      <div className="grid grid-cols-1 gap-10 sm:grid-cols-2">
        <div>
          <h3 className="mb-4 text-sm font-medium uppercase tracking-wide">
            Image de test
          </h3>
          <NumField
            label="Taille (px)"
            value={testN}
            onChange={setTestN}
            step={16}
            min={16}
            max={1024}
          />
          <div className="mt-4">
            <Button onClick={runTestImage} disabled={testLoading}>
              {testLoading ? "Generation..." : "Generer"}
            </Button>
          </div>
          <div className="mt-6">
            <ImageFrame src={testUrl} placeholder="Aucune image generee" />
          </div>
        </div>

        <div>
          <h3 className="mb-4 text-sm font-medium uppercase tracking-wide">
            Debruitage complet
          </h3>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <NumField
              label="Taille"
              value={ddParams.n}
              onChange={(v) => setDdParams((p) => ({ ...p, n: v }))}
              min={16}
              max={512}
            />
            <NumField
              label="Sigma bruit"
              value={ddParams.noise_sigma}
              onChange={(v) => setDdParams((p) => ({ ...p, noise_sigma: v }))}
              step={0.01}
              min={0}
              max={1}
            />
            <NumField
              label="Seed"
              value={ddParams.seed}
              onChange={(v) => setDdParams((p) => ({ ...p, seed: v }))}
              min={0}
            />
            <NumField
              label="Lambda TV"
              value={ddParams.lam}
              onChange={(v) => setDdParams((p) => ({ ...p, lam: v }))}
              step={0.01}
              min={0.01}
            />
            <NumField
              label="Iterations"
              value={ddParams.n_iter}
              onChange={(v) => setDdParams((p) => ({ ...p, n_iter: v }))}
              min={1}
              max={2000}
            />
            <NumField
              label="Sigma gaussien"
              value={ddParams.sigma}
              onChange={(v) => setDdParams((p) => ({ ...p, sigma: v }))}
              step={0.1}
              min={0.1}
            />
          </div>
          <div className="mt-4">
            <Button onClick={runDemoDenoising} disabled={ddLoading}>
              {ddLoading ? "Traitement..." : "Lancer la demo"}
            </Button>
          </div>
          <div className="mt-6">
            <ImageFrame src={ddUrl} placeholder="Originale / bruitee / TV / gaussien" />
          </div>
          <MetricsGrid metrics={ddMetrics} />
        </div>
      </div>

      <div className="mt-14">
        <h3 className="mb-4 text-sm font-medium uppercase tracking-wide">
          Inpainting complet
        </h3>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <NumField
            label="Taille"
            value={diParams.n}
            onChange={(v) => setDiParams((p) => ({ ...p, n: v }))}
            min={16}
            max={512}
          />
          <NumField
            label="Hauteur bande"
            value={diParams.band_height}
            onChange={(v) => setDiParams((p) => ({ ...p, band_height: v }))}
            min={1}
            max={100}
          />
          <NumField
            label="Lambda"
            value={diParams.lam}
            onChange={(v) => setDiParams((p) => ({ ...p, lam: v }))}
            step={0.01}
            min={0}
          />
          <NumField
            label="Iterations"
            value={diParams.n_iter}
            onChange={(v) => setDiParams((p) => ({ ...p, n_iter: v }))}
            min={1}
            max={3000}
          />
        </div>
        <div className="mt-4">
          <Button onClick={runDemoInpainting} disabled={diLoading}>
            {diLoading ? "Traitement..." : "Lancer la demo"}
          </Button>
        </div>
        <div className="mt-6 sm:w-1/2">
          <ImageFrame src={diUrl} placeholder="Originale / masquee / reconstruite" />
        </div>
        <MetricsGrid metrics={diMetrics} />
      </div>

      <ErrorBanner message={error} />
    </section>
  );
}

/* ----------------------------- Debruitage ----------------------------------*/

function DenoiseSection({ apiBase }: { apiBase: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [inputUrl, setInputUrl] = useObjectUrl();
  const [method, setMethod] = useState<"tv" | "gaussian">("tv");
  const [lam, setLam] = useState(0.12);
  const [nIter, setNIter] = useState(200);
  const [sigma, setSigma] = useState(1.5);
  const [outputUrl, setOutputUrl] = useObjectUrl();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleFile(f: File | null) {
    setFile(f);
    setInputUrl(f);
    setOutputUrl(null);
    setMetrics(null);
  }

  async function run() {
    if (!file) {
      setError("Selectionnez une image.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const path =
        method === "tv"
          ? `/denoise/tv?lam=${lam}&n_iter=${nIter}`
          : `/denoise/gaussian?sigma=${sigma}`;
      const { blob, metrics } = await apiRequest(apiBase, path, {
        method: "POST",
        body: fd,
      });
      setOutputUrl(blob);
      setMetrics(metrics);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section id="denoise" className="pt-28">
      <SectionHeading
        index="02"
        title="Debruitage"
        description="Uploadez une image bruitee et choisissez l'algorithme de restauration : variation totale (Chambolle) ou filtre gaussien."
      />

      <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        <label className="flex w-full cursor-pointer flex-col gap-1.5 sm:max-w-xs">
          <span className="font-mono text-[11px] uppercase tracking-wider text-neutral-500">
            Image
          </span>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
            className="border border-neutral-300 px-3 py-2 text-sm file:mr-3 file:border-0 file:bg-black file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white"
          />
        </label>

        <div className="flex border border-black">
          <button
            onClick={() => setMethod("tv")}
            className={`px-4 py-2 text-sm font-medium ${
              method === "tv" ? "bg-black text-white" : "bg-white text-black"
            }`}
          >
            Variation totale
          </button>
          <button
            onClick={() => setMethod("gaussian")}
            className={`border-l border-black px-4 py-2 text-sm font-medium ${
              method === "gaussian"
                ? "bg-black text-white"
                : "bg-white text-black"
            }`}
          >
            Filtre gaussien
          </button>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:max-w-md sm:grid-cols-2">
        {method === "tv" ? (
          <>
            <NumField label="Lambda" value={lam} onChange={setLam} step={0.01} min={0.01} />
            <NumField label="Iterations" value={nIter} onChange={setNIter} min={1} max={2000} />
          </>
        ) : (
          <NumField label="Sigma" value={sigma} onChange={setSigma} step={0.1} min={0.1} />
        )}
      </div>

      <div className="mt-6">
        <Button onClick={run} disabled={loading}>
          {loading ? "Traitement..." : "Debruiter"}
        </Button>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div>
          <h3 className="mb-3 text-xs uppercase tracking-wide text-neutral-500">
            Originale
          </h3>
          <ImageFrame src={inputUrl} placeholder="Aucune image selectionnee" />
        </div>
        <div>
          <h3 className="mb-3 text-xs uppercase tracking-wide text-neutral-500">
            Resultat
          </h3>
          <ImageFrame src={outputUrl} placeholder="En attente de traitement" />
        </div>
      </div>

      <MetricsGrid metrics={metrics} />
      <ErrorBanner message={error} />
    </section>
  );
}

/* ----------------------------- Inpainting -----------------------------------*/

const MASK_MAX_DIM = 420;

function InpaintSection({ apiBase }: { apiBase: string }) {
  const displayCanvasRef = useRef<HTMLCanvasElement>(null);
  const imgCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);

  const [hasImage, setHasImage] = useState(false);
  const [brushSize, setBrushSize] = useState(16);
  const [lam, setLam] = useState(0);
  const [nIter, setNIter] = useState(300);
  const [outputUrl, setOutputUrl] = useObjectUrl();
  const [maskedPreviewUrl, setMaskedPreviewUrl] = useObjectUrl();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleFile(file: File | null) {
    setError(null);
    setOutputUrl(null);
    setMaskedPreviewUrl(null);
    setMetrics(null);
    if (!file) {
      setHasImage(false);
      return;
    }
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MASK_MAX_DIM / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));

      const imgCanvas = document.createElement("canvas");
      imgCanvas.width = w;
      imgCanvas.height = h;
      imgCanvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
      imgCanvasRef.current = imgCanvas;

      const maskCanvas = document.createElement("canvas");
      maskCanvas.width = w;
      maskCanvas.height = h;
      const mctx = maskCanvas.getContext("2d")!;
      mctx.fillStyle = "black";
      mctx.fillRect(0, 0, w, h);
      maskCanvasRef.current = maskCanvas;

      const display = displayCanvasRef.current!;
      display.width = w;
      display.height = h;
      display.getContext("2d")!.drawImage(imgCanvas, 0, 0);

      setHasImage(true);
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
  }

  function clearMask() {
    if (!imgCanvasRef.current || !maskCanvasRef.current || !displayCanvasRef.current)
      return;
    const { width, height } = imgCanvasRef.current;
    const mctx = maskCanvasRef.current.getContext("2d")!;
    mctx.fillStyle = "black";
    mctx.fillRect(0, 0, width, height);
    displayCanvasRef.current.getContext("2d")!.drawImage(imgCanvasRef.current, 0, 0);
  }

  function canvasPoint(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = displayCanvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  function strokeSegment(from: { x: number; y: number }, to: { x: number; y: number }) {
    const display = displayCanvasRef.current;
    const maskCanvas = maskCanvasRef.current;
    if (!display || !maskCanvas) return;

    for (const [canvas, color] of [
      [display, "rgba(0,0,0,0.45)"],
      [maskCanvas, "white"],
    ] as const) {
      const ctx = canvas.getContext("2d")!;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = brushSize;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      // point isole (clic simple sans mouvement)
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(to.x, to.y, brushSize / 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!hasImage) return;
    drawingRef.current = true;
    const point = canvasPoint(e);
    lastPointRef.current = point;
    strokeSegment(point, point);
  }
  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const point = canvasPoint(e);
    strokeSegment(lastPointRef.current ?? point, point);
    lastPointRef.current = point;
  }
  function onPointerUp() {
    drawingRef.current = false;
    lastPointRef.current = null;
  }

  async function run() {
    if (!imgCanvasRef.current || !maskCanvasRef.current) {
      setError("Selectionnez une image et dessinez la zone a reconstruire.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const imageBlob = await canvasToBlob(imgCanvasRef.current);
      const maskBlob = await canvasToBlob(maskCanvasRef.current);
      setMaskedPreviewUrl(
        await canvasToBlob(displayCanvasRef.current!)
      );

      const fd = new FormData();
      fd.append("file", imageBlob, "image.png");
      fd.append("mask_file", maskBlob, "mask.png");

      const { blob, metrics } = await apiRequest(
        apiBase,
        `/inpaint?lam=${lam}&n_iter=${nIter}`,
        { method: "POST", body: fd }
      );
      setOutputUrl(blob);
      setMetrics(metrics);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section id="inpaint" className="pt-28">
      <SectionHeading
        index="03"
        title="Inpainting"
        description="Uploadez une image puis peignez directement sur le canevas la zone manquante a reconstruire. Le masque est genere automatiquement a partir du trace."
      />

      <label className="flex w-full cursor-pointer flex-col gap-1.5 sm:max-w-xs">
        <span className="font-mono text-[11px] uppercase tracking-wider text-neutral-500">
          Image
        </span>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
          className="border border-neutral-300 px-3 py-2 text-sm file:mr-3 file:border-0 file:bg-black file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white"
        />
      </label>

      {hasImage && (
        <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center">
          <label className="flex flex-1 items-center gap-3">
            <span className="whitespace-nowrap font-mono text-[11px] uppercase tracking-wider text-neutral-500">
              Pinceau
            </span>
            <input
              type="range"
              min={2}
              max={60}
              value={brushSize}
              onChange={(e) => setBrushSize(parseInt(e.target.value, 10))}
              className="w-full max-w-xs"
            />
          </label>
          <Button variant="secondary" onClick={clearMask}>
            Effacer le masque
          </Button>
        </div>
      )}

      <div className="mt-6 w-full max-w-md">
        <canvas
          ref={displayCanvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          className={`w-full touch-none border border-neutral-300 ${
            hasImage ? "cursor-crosshair" : ""
          }`}
          style={{ display: hasImage ? "block" : "none", aspectRatio: "1 / 1" }}
        />
        {!hasImage && (
          <div className="flex aspect-square w-full items-center justify-center border border-neutral-200 bg-neutral-50">
            <span className="px-4 text-center font-mono text-xs text-neutral-400">
              Selectionnez une image pour dessiner le masque
            </span>
          </div>
        )}
      </div>

      <div className="mt-8 grid grid-cols-2 gap-4 sm:max-w-md">
        <NumField label="Lambda" value={lam} onChange={setLam} step={0.01} min={0} />
        <NumField label="Iterations" value={nIter} onChange={setNIter} min={1} max={3000} />
      </div>

      <div className="mt-6">
        <Button onClick={run} disabled={loading || !hasImage}>
          {loading ? "Reconstruction..." : "Reconstruire"}
        </Button>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div>
          <h3 className="mb-3 text-xs uppercase tracking-wide text-neutral-500">
            Image + masque envoyes
          </h3>
          <ImageFrame src={maskedPreviewUrl} placeholder="Apparait apres lancement" />
        </div>
        <div>
          <h3 className="mb-3 text-xs uppercase tracking-wide text-neutral-500">
            Resultat
          </h3>
          <ImageFrame src={outputUrl} placeholder="En attente de traitement" />
        </div>
      </div>

      <MetricsGrid metrics={metrics} />
      <ErrorBanner message={error} />
    </section>
  );
}

/* ----------------------------- Comparaison -----------------------------------*/

function CompareSection({ apiBase }: { apiBase: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [refFile, setRefFile] = useState<File | null>(null);
  const [lam, setLam] = useState(0.12);
  const [nIter, setNIter] = useState(200);
  const [sigma, setSigma] = useState(1.5);
  const [outputUrl, setOutputUrl] = useObjectUrl();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!file) {
      setError("Selectionnez une image bruitee.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (refFile) fd.append("reference_file", refFile);
      const { blob, metrics } = await apiRequest(
        apiBase,
        `/compare?lam=${lam}&n_iter=${nIter}&sigma=${sigma}`,
        { method: "POST", body: fd }
      );
      setOutputUrl(blob);
      setMetrics(metrics);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section id="compare" className="pt-28">
      <SectionHeading
        index="04"
        title="Comparaison"
        description="Confronte le debruitage TV au filtre gaussien sur la meme image. Ajoutez une reference propre pour obtenir le PSNR."
      />

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[11px] uppercase tracking-wider text-neutral-500">
            Image bruitee
          </span>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="border border-neutral-300 px-3 py-2 text-sm file:mr-3 file:border-0 file:bg-black file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[11px] uppercase tracking-wider text-neutral-500">
            Reference (optionnel)
          </span>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setRefFile(e.target.files?.[0] ?? null)}
            className="border border-neutral-300 px-3 py-2 text-sm file:mr-3 file:border-0 file:bg-black file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white"
          />
        </label>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:max-w-lg sm:grid-cols-3">
        <NumField label="Lambda (TV)" value={lam} onChange={setLam} step={0.01} min={0.01} />
        <NumField label="Iterations" value={nIter} onChange={setNIter} min={1} max={2000} />
        <NumField label="Sigma (gaussien)" value={sigma} onChange={setSigma} step={0.1} min={0.1} />
      </div>

      <div className="mt-6">
        <Button onClick={run} disabled={loading}>
          {loading ? "Comparaison..." : "Comparer"}
        </Button>
      </div>

      <div className="mt-8">
        <h3 className="mb-3 text-xs uppercase tracking-wide text-neutral-500">
          Bruitee — TV — Gaussien
        </h3>
        <div className="flex w-full items-center justify-center border border-neutral-200 bg-neutral-50 p-2">
          {outputUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={outputUrl} alt="" className="max-h-[420px] w-full object-contain" />
          ) : (
            <span className="py-20 font-mono text-xs text-neutral-400">
              En attente de traitement
            </span>
          )}
        </div>
      </div>

      <MetricsGrid metrics={metrics} />
      <ErrorBanner message={error} />
    </section>
  );
}

/* -------------------------------- Footer -------------------------------------*/

function Footer() {
  return (
    <footer className="border-t border-black px-6 py-10 sm:px-10">
      <div className="mx-auto flex max-w-5xl flex-col gap-2 font-mono text-xs text-neutral-500 sm:flex-row sm:items-center sm:justify-between">
        <span>Projet 4 — Modele variationnel TV (Rudin-Osher-Fatemi)</span>
        <span>API FastAPI · Frontend Next.js</span>
      </div>
    </footer>
  );
}

#!/usr/bin/env bash
# Lance l'API du Projet 4 (TV / ROF) depuis n'importe quel repertoire.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

PORT="${PORT:-8000}"

echo "Verification des dependances..."
python3 -c "import fastapi, uvicorn, numpy, scipy, matplotlib, PIL" 2>/dev/null \
  || pip install --quiet fastapi "uvicorn[standard]" numpy scipy matplotlib pillow python-multipart

echo "Demarrage de l'API sur http://localhost:${PORT}  (docs: http://localhost:${PORT}/docs)"
exec python3 -m uvicorn app:app --reload --port "${PORT}"

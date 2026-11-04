#!/bin/bash
set -euo pipefail
cd /work
apt-get update -qq
apt-get install -y --no-install-recommends python3-venv
python3 -m venv /work/venv
/work/venv/bin/pip install --disable-pip-version-check 'onnx==1.19.1' 'numpy==2.2.6' 'protobuf==7.36.2' 'typing_extensions==4.16.0' 'ml_dtypes==0.6.0'
/work/venv/bin/python -u convert.py

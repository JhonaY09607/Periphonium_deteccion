#!/bin/bash

# Guardar la ruta del directorio actual
CURRENT_DIR=$(pwd)

#ejecutar venv
source "$CURRENT_DIR/vcard/bin/activate"

# Ejecutar el script de Python
python "$CURRENT_DIR/raspconsumer_entrada.py"
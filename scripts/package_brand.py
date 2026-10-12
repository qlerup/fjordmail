from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
root=Path(__file__).resolve().parents[1]
with ZipFile(root/'branding'/'FjordMail-brand-package.zip','w',compression=ZIP_DEFLATED) as archive:
    for path in [root/'branding/icon-master.png',root/'branding/README.md',root/'branding/exports.json',*sorted((root/'web/public/logos').glob('*'))]:
        archive.write(path,path.relative_to(root))
print('Created branding/FjordMail-brand-package.zip')

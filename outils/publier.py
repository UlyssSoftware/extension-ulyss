# Fabrique, à partir du dossier source : le zip d'installation et le dossier « fichiers » à déposer sur le site.
import json, hashlib, os, shutil, sys, zipfile, datetime
D=os.path.dirname(os.path.abspath(__file__)); SRC=os.path.join(D,'ulyss-chiffrage-grille'); OUT=sys.argv[1] if len(sys.argv)>1 else os.path.join(D,'publication')
# Tarifs : les fichiers en clair (prive/grilles.js, prive/forfaits.js) ne sont jamais publiés. Ils sont évalués, mis en JSON et chiffrés
# (AES-256-GCM, clé = PBKDF2-SHA256 du code d'accès, 600 000 tours). Le sel est conservé d'une publication à l'autre : tant que le
# code ne change pas, les postes n'ont pas à le ressaisir. Le code est lu dans prive/code.txt, jamais écrit ailleurs.
import subprocess, base64, hashlib as _h
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
PRIVE=os.path.join(D,'prive'); CHIFFRE=os.path.join(SRC,'tarifs.json'); ITER=600000
clair=subprocess.run(['node',os.path.join(D,'tarifs-en-json.js'),os.path.join(PRIVE,'grilles.js'),os.path.join(PRIVE,'forfaits.js')],capture_output=True,check=True).stdout
code=open(os.path.join(PRIVE,'code.txt'),encoding='utf8').read()
ancien=json.load(open(CHIFFRE)) if os.path.exists(CHIFFRE) else None
def cle(sel): return _h.pbkdf2_hmac('sha256',code.encode('utf8'),sel,ITER,32)
refaire=True
if ancien:
    try:
        if AESGCM(cle(base64.b64decode(ancien['sel']))).decrypt(base64.b64decode(ancien['iv']),base64.b64decode(ancien['donnees']),None)==clair: refaire=False   # tarifs inchangés : on garde le fichier tel quel
        sel=base64.b64decode(ancien['sel'])
    except Exception: sel=os.urandom(16)   # code changé : nouveau sel, les postes redemanderont le code
else: sel=os.urandom(16)
if refaire:
    iv=os.urandom(12)
    json.dump({'v':1,'kdf':'PBKDF2-SHA256','iterations':ITER,'sel':base64.b64encode(sel).decode(),'iv':base64.b64encode(iv).decode(),'donnees':base64.b64encode(AESGCM(cle(sel)).encrypt(iv,clair,None)).decode()}, open(CHIFFRE,'w'))
print('tarifs:', 'rechiffrés' if refaire else 'inchangés', len(clair), 'octets en clair')
noms=sorted(f for f in os.listdir(SRC) if os.path.isfile(os.path.join(SRC,f)))
v=json.load(open(os.path.join(SRC,'manifest.json'),encoding='utf8'))['version']
shutil.rmtree(OUT, ignore_errors=True); os.makedirs(os.path.join(OUT,'fichiers'))
emp={}
for f in noms:
    b=open(os.path.join(SRC,f),'rb').read(); emp[f]=hashlib.sha256(b).hexdigest(); open(os.path.join(OUT,'fichiers',f),'wb').write(b)
json.dump({'version':v,'date':datetime.date.today().isoformat(),'fichiers':noms,'empreintes':emp}, open(os.path.join(OUT,'fichiers','version.json'),'w',encoding='utf8'), ensure_ascii=False, indent=1)
with zipfile.ZipFile(os.path.join(OUT,'ulyss-chiffrage-extension.zip'),'w',zipfile.ZIP_DEFLATED) as z:
    for f in noms: z.write(os.path.join(SRC,f), f)
with zipfile.ZipFile(os.path.join(OUT,'a-deposer-sur-le-site-%s.zip'%v),'w',zipfile.ZIP_DEFLATED) as z:
    for f in noms+['version.json']: z.write(os.path.join(OUT,'fichiers',f), 'fichiers/'+f)
print(v, noms)

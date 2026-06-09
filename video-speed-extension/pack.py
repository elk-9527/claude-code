#!/usr/bin/env python3
"""Pack Chrome/Edge extension as .crx file (CRX3 format)

CRX3 verification (from Chromium source):
  1. Parse CrxFileHeader protobuf from CRX
  2. Extract signature from sha256_with_rsa proof
  3. Call proof.clear_signature() → removes the signature field entirely
  4. Re-serialize CrxFileHeader (now shorter, without signature bytes)
  5. verified_blob = re_serialized_header + next signed_header_size bytes
  6. SHA256(verified_blob) → verify RSA signature

So we MUST:
  a) Build placeholder WITHOUT the signature field
  b) Sign: SHA256(placeholder_no_sig + zip)
  c) Build final WITH signature field
  d) signed_header_size = len(zip_data)
"""

import os, struct, zipfile, io, hashlib

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa

EXT_DIR = r"C:\Users\Lenovo\Desktop\claude code\video-speed-extension"
OUT_DIR = r"C:\Users\Lenovo\Desktop\claude code"

SIG_LEN = 256

def _pb_varint(v):
    out = b""
    while v > 0x7F:
        out += bytes([(v & 0x7F) | 0x80])
        v >>= 7
    out += bytes([v])
    return out

def _pb_len_delimited(field_num, data):
    tag = _pb_varint((field_num << 3) | 2)
    return tag + _pb_varint(len(data)) + data

def _pb_uint64(field_num, value):
    tag = _pb_varint((field_num << 3) | 0)
    return tag + _pb_varint(value)

def build_header(pubkey_der, signature, signed_header_size):
    """Build CrxFileHeader protobuf."""
    # AsymmetricKeyProof
    proof = _pb_len_delimited(1, pubkey_der)  # public_key
    if signature is not None:
        proof += _pb_len_delimited(2, signature)  # signature
    # CrxFileHeader
    header = (
        _pb_len_delimited(2, proof) +       # sha256_with_rsa
        _pb_uint64(10000, signed_header_size)
    )
    return header

def main():
    # 1. Pack extension as ZIP
    print("[1/5] Packing extension as ZIP...")
    zip_buf = io.BytesIO()
    with zipfile.ZipFile(zip_buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, _, files in os.walk(EXT_DIR):
            for f in sorted(files):
                if f.endswith('.py'):
                    continue
                full = os.path.join(root, f)
                arcname = os.path.relpath(full, EXT_DIR)
                zf.write(full, arcname)
                print("   +", arcname)
    zip_data = zip_buf.getvalue()
    print("   ZIP:", len(zip_data), "bytes")

    # 2. Generate key pair
    key_path = os.path.join(OUT_DIR, "vsc-extension-key.pem")
    print("\n[2/5] Generating RSA key pair...")
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    with open(key_path, "wb") as f:
        f.write(private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption()))
    pubkey_der = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PublicFormat.SubjectPublicKeyInfo)
    print("   Pubkey DER:", len(pubkey_der), "bytes")

    # 3. signed_header_size = len(zip_data) in CRX3
    #    Build placeholder WITHOUT signature (mimics clear_signature())
    signed_header_size = len(zip_data)
    print("\n[3/5] Building placeholder header (NO signature field)...")
    header_no_sig = build_header(pubkey_der, None, signed_header_size)
    print("   header_no_sig:", len(header_no_sig), "bytes")
    print("   signed_header_size:", signed_header_size)

    # 4. verified_blob = header_no_sig + zip_data
    verified_blob = header_no_sig + zip_data
    print(f"\n[4/5] Signing verified_blob ({len(verified_blob)} bytes)...")
    blob_hash = hashlib.sha256(verified_blob).digest()
    print("   SHA256:", blob_hash.hex())

    signature = private_key.sign(blob_hash, padding.PKCS1v15(), hashes.SHA256())
    print("   Signature:", len(signature), "bytes")
    assert len(signature) == SIG_LEN

    # 5. Build final header WITH signature
    print("\n[5/5] Building final header (WITH signature)...")
    final_header = build_header(pubkey_der, signature, signed_header_size)
    print("   final_header:", len(final_header), "bytes")
    print("   delta =", len(final_header) - len(header_no_sig), "bytes (signature field overhead)")

    # 6. Write CRX3
    crx = b"Cr24"
    crx += struct.pack("<I", 3)
    crx += struct.pack("<I", len(final_header))
    crx += final_header
    crx += zip_data

    out_path = os.path.join(OUT_DIR, "video-speed-extension.crx")
    with open(out_path, "wb") as f:
        f.write(crx)

    print("\n" + "=" * 55)
    print(f"  DONE!  {len(crx)} bytes ({len(crx)/1024:.1f} KB)")
    print(f"  File: {out_path}")
    print("  Install: drag onto edge://extensions/ (Dev mode ON)")
    print("=" * 55)

if __name__ == "__main__":
    main()

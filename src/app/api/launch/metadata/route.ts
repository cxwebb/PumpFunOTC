import { APP_DOMAIN } from "@/lib/config";
import { requireEnv, serverEnv } from "@/server/env";
import { HttpError, handle, json } from "@/server/http";
import { requireWallet } from "@/server/session";

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

function field(form: FormData, name: string, max: number, required = false): string | undefined {
  const v = form.get(name);
  if (v === null || v === "") {
    if (required) throw new HttpError(400, `${name} is required`);
    return undefined;
  }
  if (typeof v !== "string" || v.length > max) throw new HttpError(400, `${name} is invalid`);
  return v.trim();
}

function optionalUrl(v: string | undefined, name: string) {
  if (!v) return undefined;
  try {
    const u = new URL(v);
    if (u.protocol !== "https:") throw new Error();
    return u.toString();
  } catch {
    throw new HttpError(400, `${name} must be an https URL`);
  }
}

/** Upload token image + metadata JSON to IPFS via Pinata. Returns the metadata URI. */
export const POST = handle(async (req) => {
  await requireWallet();
  const { PINATA_JWT } = requireEnv("PINATA_JWT");
  const gateway = (serverEnv.PINATA_GATEWAY || "https://gateway.pinata.cloud").replace(/\/$/, "");
  const form = await req.formData();
  const name = field(form, "name", 32, true)!;
  const symbol = field(form, "symbol", 10, true)!;
  const description = field(form, "description", 1000) ?? "";
  const twitter = optionalUrl(field(form, "twitter", 200), "twitter");
  const telegram = optionalUrl(field(form, "telegram", 200), "telegram");
  const website = optionalUrl(field(form, "website", 200), "website");
  const image = form.get("image");
  if (!(image instanceof File)) throw new HttpError(400, "image is required");
  if (!IMAGE_TYPES.has(image.type)) throw new HttpError(400, "Image must be PNG, JPEG, GIF or WebP");
  if (image.size > MAX_IMAGE_BYTES) throw new HttpError(400, "Image must be 4 MB or smaller");

  const fileForm = new FormData();
  fileForm.append("file", image, image.name || "image");
  const imgRes = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
    method: "POST",
    headers: { Authorization: `Bearer ${PINATA_JWT}` },
    body: fileForm,
  });
  if (!imgRes.ok) throw new HttpError(502, `Image upload failed (${imgRes.status})`);
  const imageCid = ((await imgRes.json()) as { IpfsHash: string }).IpfsHash;
  const imageUrl = `${gateway}/ipfs/${imageCid}`;

  const metadata = { name, symbol, description, image: imageUrl, showName: true, createdOn: `https://${APP_DOMAIN}`, twitter, telegram, website };
  const jsonRes = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
    method: "POST",
    headers: { Authorization: `Bearer ${PINATA_JWT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ pinataContent: metadata, pinataMetadata: { name: `${symbol}-metadata.json` } }),
  });
  if (!jsonRes.ok) throw new HttpError(502, `Metadata upload failed (${jsonRes.status})`);
  const metaCid = ((await jsonRes.json()) as { IpfsHash: string }).IpfsHash;
  return json({ uri: `${gateway}/ipfs/${metaCid}`, image: imageUrl, metadata });
});

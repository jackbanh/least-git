import { useEffect, useState } from "react";
import { Avatar } from "@mantine/core";

// Module-level: survive re-renders and tab switches without recomputing hashes.
const emailHashCache = new Map<string, string>(); // email → SHA-256 hex

async function getEmailHash(email: string): Promise<string> {
  const key = email.trim().toLowerCase();
  if (emailHashCache.has(key)) return emailHashCache.get(key)!;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  const hex = Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  emailHashCache.set(key, hex);
  return hex;
}

export default function CommitAvatar({ name, email }: { name: string; email: string }) {
  const [hash, setHash] = useState<string | null>(
    () => emailHashCache.get(email.trim().toLowerCase()) ?? null
  );

  useEffect(() => {
    if (hash) return;
    let cancelled = false;
    getEmailHash(email).then((h) => { if (!cancelled) setHash(h); });
    return () => { cancelled = true; };
  }, [email, hash]);

  return (
    <Avatar
      src={hash ? `https://gravatar.com/avatar/${hash}?s=36&d=404` : undefined}
      size={18}
      radius="xl"
      color="initials"
      name={name}
    />
  );
}

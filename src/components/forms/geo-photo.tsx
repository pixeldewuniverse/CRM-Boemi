"use client";

import { useRef, useState } from "react";
import { compressImage } from "@/lib/compress-image";
import { useFormErrors } from "./form-dialog";

/** Shrink a phone photo in the browser (max 1600px, JPEG ~80%) before upload. */
const compress = (file: File) => compressImage(file, 1600, { name: "visit.jpg" });

/** GPS check-in + camera photo, written into the surrounding <form>. */
export function GeoPhotoFields() {
  const errors = useFormErrors().fieldErrors ?? {};
  const [pos, setPos] = useState<{ lat: number; lng: number; acc: number } | null>(null);
  const [geoMsg, setGeoMsg] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [photoMsg, setPhotoMsg] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const locate = () => {
    if (!("geolocation" in navigator)) return setGeoMsg("This device can't share its location.");
    setLocating(true);
    setGeoMsg(null);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setPos({ lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy) });
        setLocating(false);
      },
      (err) => {
        setLocating(false);
        setGeoMsg(
          err.code === err.PERMISSION_DENIED
            ? "Location is blocked. Allow location for this site in your browser settings, then try again."
            : "Couldn't get your location. Move to an open area and try again.",
        );
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
  };

  const onPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setPhotoMsg(null);
    if (!file) return setPreview(null);
    try {
      const small = await compress(file);
      const dt = new DataTransfer();
      dt.items.add(small);
      e.target.files = dt.files;
      setPreview(URL.createObjectURL(small));
      setPhotoMsg(`Photo ready (${Math.round(small.size / 1024)} KB)`);
    } catch {
      setPreview(URL.createObjectURL(file));
    }
  };

  const locErr = errors.location ?? errors.lat;
  return (
    <>
      <div className="flex flex-col gap-1 sm:col-span-2">
        <span className="text-[13px] font-semibold">
          Location<span className="text-bad"> *</span>
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn" onClick={locate} disabled={locating}>
            {locating ? "Locating…" : pos ? "Update location" : "Get my location"}
          </button>
          {pos && (
            <a
              href={`https://www.google.com/maps?q=${pos.lat},${pos.lng}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[13px] text-accent hover:underline"
            >
              {pos.lat.toFixed(5)}, {pos.lng.toFixed(5)} · ±{pos.acc} m ↗
            </a>
          )}
        </div>
        {pos && pos.acc > 200 && <p className="text-xs text-warn">Low accuracy — step outside or wait a moment and update.</p>}
        {(geoMsg || locErr) && <p className="text-xs text-bad">{geoMsg ?? locErr}</p>}
        <input type="hidden" name="lat" value={pos?.lat ?? ""} />
        <input type="hidden" name="lng" value={pos?.lng ?? ""} />
      </div>

      <div className="flex flex-col gap-1 sm:col-span-2">
        <label htmlFor="visit-photo" className="text-[13px] font-semibold">
          Photo at the location<span className="text-bad"> *</span>
        </label>
        <input
          ref={fileInput}
          id="visit-photo"
          name="photo"
          type="file"
          accept="image/*"
          capture="environment"
          onChange={onPhoto}
          className="input file:mr-3 file:rounded-md file:border-0 file:bg-accent-soft file:px-2 file:py-1 file:text-accent"
        />
        {preview && (
          // eslint-disable-next-line @next/next/no-img-element -- local blob preview
          <img src={preview} alt="Visit photo preview" className="mt-1 max-h-40 w-auto self-start rounded-lg border border-line" />
        )}
        {errors.photo ? <p className="text-xs text-bad">{errors.photo}</p> : photoMsg && <p className="text-xs text-muted">{photoMsg}</p>}
      </div>
    </>
  );
}

const audioTypes = [
  "audio/webm;codecs=opus",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/ogg;codecs=opus",
  "audio/webm",
  "audio/ogg",
] as const;

const videoTypes = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/mp4;codecs=avc1,mp4a.40.2",
  "video/mp4",
  "video/webm",
] as const;

export function preferredRecordingMime(withVideo: boolean,isSupported: (mime: string) => boolean) {
  return (withVideo ? videoTypes : audioTypes).find(isSupported);
}

export function baseRecordingMime(mime: string,withVideo: boolean) {
  const base = mime.split(";", 1)[0]?.trim().toLowerCase();
  if (base?.startsWith(withVideo ? "video/" : "audio/")) return base;
  return withVideo ? "video/webm" : "audio/webm";
}

export function recordingExtension(mime: string) {
  if (mime === "video/mp4") return "mp4";
  if (mime === "audio/mp4") return "m4a";
  if (mime === "audio/ogg") return "ogg";
  return "webm";
}

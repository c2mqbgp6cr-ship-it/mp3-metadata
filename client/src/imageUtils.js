// Reads an image file and center-crops it to a square as a lossless PNG
// data URL. The heavy lifting (final format choice, quality, and the
// <500 KB size cap) happens server-side with sharp, which does a much
// better job than the browser canvas at balancing size vs. quality — this
// step only guarantees the crop is a perfect square before sending it on.
const MAX_SIZE = 2000;

export function fileToSquareDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Impossible de lire l'image."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Fichier image invalide."));
      img.onload = () => {
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2;
        const sy = (img.height - side) / 2;
        const outSide = Math.min(side, MAX_SIZE);

        const canvas = document.createElement("canvas");
        canvas.width = outSide;
        canvas.height = outSide;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, sx, sy, side, side, 0, 0, outSide, outSide);

        resolve({
          dataUrl: canvas.toDataURL("image/png"),
          wasCropped: img.width !== img.height,
        });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

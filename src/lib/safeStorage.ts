// localStorage/sessionStorage kastar i privat läge, vid blockerade webbplatsdata
// och i vissa inbäddade vyer. Appen ska fungera (utan persistens) i de fallen.
// Åtkomsten sker via getter eftersom själva property-läsningen kan kasta.
const wrap = (getStorage: () => Storage) => ({
  getItem(key: string): string | null {
    try {
      return getStorage().getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string): void {
    try {
      getStorage().setItem(key, value);
    } catch {
      // Ingen persistens tillgänglig — ignoreras medvetet.
    }
  },
  removeItem(key: string): void {
    try {
      getStorage().removeItem(key);
    } catch {
      // Ingen persistens tillgänglig — ignoreras medvetet.
    }
  },
});

export const safeStorage = wrap(() => localStorage);
export const safeSessionStorage = wrap(() => sessionStorage);

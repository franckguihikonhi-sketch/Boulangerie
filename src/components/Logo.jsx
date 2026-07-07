import { useState } from 'react';

// Logo de l'application. Charge /logo.png (déposé dans public/) ; si le fichier
// est absent, affiche le pictogramme 🥖 en secours, de la même taille.
export default function Logo({ size = 40, rounded = 'rounded-lg', className = '' }) {
  const [ok, setOk] = useState(true);
  const style = { width: size, height: size };

  if (ok) {
    return (
      <img
        src="./logo.jpg"
        alt="Boulangerie ERP"
        onError={() => setOk(false)}
        style={style}
        className={`flex-none object-contain ${rounded} ${className}`}
      />
    );
  }
  return (
    <span
      style={style}
      className={`flex flex-none items-center justify-center bg-brand-600 ${rounded} ${className}`}
    >
      <span style={{ fontSize: size * 0.5, lineHeight: 1 }}>🥖</span>
    </span>
  );
}

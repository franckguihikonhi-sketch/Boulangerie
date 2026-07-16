// ===========================================================================
// EXPORT PDF RÉEL (fichier .pdf, jamais .html)
// ---------------------------------------------------------------------------
// Convertit un document HTML autonome (le même contenu que l'aperçu à
// l'écran) en un véritable fichier PDF téléchargeable, sans dépendre de la
// boîte d'impression du navigateur ni des pop-ups (window.print/window.open),
// qui sont bloqués dans de nombreux environnements et forçaient jusqu'ici un
// repli vers un fichier HTML — remplacé ici par un rendu bitmap fidèle (une
// page par bloc, ex. un bulletin) intégré dans un vrai PDF via jsPDF.
// ===========================================================================

import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';

// Rend un document HTML dans un iframe caché puis exporte un ou plusieurs
// blocs (`selector`, ex. « .slip ») en pages d'un PDF réel, téléchargé sous
// `filename`. Si `selector` ne matche rien, tout le <body> est utilisé.
//
// `pxWidth` fixe la largeur de rendu de l'iframe (en pixels CSS) : elle doit
// correspondre à la largeur physique de la page PDF (ex. ~794px pour un A4
// portrait à 96dpi, ~1123px pour un A4 paysage) afin que les tailles en
// millimètres du document (marges, etc.) se rendent correctement.
export async function exportHtmlToPdf(html, {
  filename = 'document.pdf',
  selector,
  orientation = 'portrait',
  format = 'a4',
  pxWidth = 794
} = {}) {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = `position:fixed;left:-10000px;top:0;width:${pxWidth}px;height:0;border:0;visibility:hidden;`;
  document.body.appendChild(iframe);

  try {
    await new Promise((resolve, reject) => {
      iframe.onload = resolve;
      iframe.onerror = reject;
      iframe.srcdoc = html;
    });
    // Laisse une frame au navigateur pour finaliser la mise en page avant capture.
    await new Promise((r) => setTimeout(r, 80));

    const doc = iframe.contentDocument;
    let targets = selector ? Array.from(doc.querySelectorAll(selector)) : [];
    if (targets.length === 0) targets = [doc.body];

    // Si le contenu (ex. un tableau très large) dépasse la largeur de rendu
    // choisie, on élargit l'iframe en conséquence AVANT capture : sans cela,
    // html2canvas rogne tout ce qui dépasse au lieu de le mettre à l'échelle.
    const neededWidth = Math.max(pxWidth, ...targets.map((el) => el.scrollWidth));
    if (neededWidth > pxWidth) {
      iframe.style.width = `${neededWidth}px`;
      void iframe.offsetWidth; // force le reflow avant capture
    }

    const pdf = new jsPDF({ orientation, unit: 'mm', format });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();

    for (let i = 0; i < targets.length; i++) {
      const canvas = await html2canvas(targets[i], {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        windowWidth: neededWidth
      });
      // JPEG plutôt que PNG : documents essentiellement blancs/texte, le
      // gain de poids est considérable (jusqu'à ~20x) pour une perte de
      // qualité imperceptible à l'impression à qualité 0.92.
      const imgData = canvas.toDataURL('image/jpeg', 0.92);
      const imgW = pageW;
      const imgH = (canvas.height * imgW) / canvas.width;

      if (i > 0) pdf.addPage(format, orientation);

      if (imgH <= pageH) {
        pdf.addImage(imgData, 'JPEG', 0, 0, imgW, imgH);
      } else {
        // Contenu plus haut qu'une page (rare) : on le répartit sur
        // plusieurs pages successives.
        let position = 0;
        let remaining = imgH;
        let firstSlice = true;
        while (remaining > 0) {
          if (!firstSlice) pdf.addPage(format, orientation);
          pdf.addImage(imgData, 'JPEG', 0, position, imgW, imgH);
          remaining -= pageH;
          position -= pageH;
          firstSlice = false;
        }
      }
    }

    pdf.save(filename);
    return true;
  } finally {
    iframe.remove();
  }
}

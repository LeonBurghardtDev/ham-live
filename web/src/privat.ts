/**
 * Quellen ohne offene Lizenz („nur privat“: Nachrichten, Radio, Verkehr.NRW-Verkehrslage, Fahrplan-Echtzeit, Webcams ohne Lizenz …)
 * laufen nur, wenn der Server sie freigibt (HAM_PRIVATQUELLEN=an oder Datei local/privatquellen-an, siehe server/konfig.ts).
 * Standard ist aus, damit eine fremde Installation keine Inhalte Dritter ohne Erlaubnis ausliefert.
 */
export const privat = { an: false }

export async function privatLaden() {
  try { privat.an = (await (await fetch('/api/gesund')).json()).privatquellen === true } catch { privat.an = false }
}

/** true, wenn eine Quelle mit dieser Lizenzangabe gerade laufen darf */
export const erlaubt = (lizenz: string) => privat.an || !/nur privat/i.test(lizenz)

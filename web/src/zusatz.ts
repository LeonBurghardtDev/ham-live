/** Einhängepunkt für Zusatzmodule: weitere Live-Quellen und die lokale Ortssuche. Wird von main.ts dynamisch geladen. */
import type { Quelle } from './live'
import { QUELLEN_HAMM } from './quellen-hamm'
import { QUELLEN_STADT } from './quellen-stadt'
import { parken } from './quellen-park'
import { orteLaden as laden, suchen } from './ortssuche'

export const QUELLEN_ZUSATZ: Quelle[] = [...QUELLEN_HAMM, ...QUELLEN_STADT, parken]
export const lokaleSuche = suchen
export const orteLaden = laden

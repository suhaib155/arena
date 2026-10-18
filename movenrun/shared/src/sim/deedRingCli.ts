/** Prints the G5 ring study table. SIMULATION ONLY. `yarn workspace @movenrun/shared sim:ring` */
import { ringStudy, ringTable } from "./deedRing";

const trials = Number(process.argv[2] ?? 30);
console.log(`G5 ring study, ${trials} detection draws per row (SIMULATION ONLY)\n`);
console.log(ringTable(ringStudy({ trials })));

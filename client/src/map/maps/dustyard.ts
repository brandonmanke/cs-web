import dustyardMap from "./dustyard.map";
import { parseValveMap } from "../mapformat";

// DUSTYARD — flagship CS 1.6-style sunlit desert/industrial compound, authored
// in standard TrenchBroom Valve-220 `.map` format. Features an open sunlit Mid
// courtyard with wallbangable wooden double doors, a dark vaulted West brick
// underpass tunnel, an elevated East sandstone catwalk, a covered industrial
// Site A loading bay, CC0 GLB props, and spray-painted site decals.
export const DUSTYARD = parseValveMap("dustyard", dustyardMap);

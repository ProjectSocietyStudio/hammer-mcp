import type { AnyToolDef } from "../mcp/registry.js";
import { bspTools } from "./bsp.js";
import { buildTools } from "./build.js";
import { clipTools } from "./clip.js";
import { compileTools } from "./compile.js";
import { contentTools } from "./content.js";
import { depsTools } from "./deps.js";
import { displacementTools } from "./displacement.js";
import { gmaTools } from "./gma.js";
import { faceTools } from "./face.js";
import { gameTools } from "./games.js";
import { healthTools } from "./health.js";
import { hollowTools } from "./hollow.js";
import { lightmapTools } from "./lightmap.js";
import { lmpTools } from "./lmp.js";
import { materialsTools } from "./materials.js";
import { measureTools } from "./measure.js";
import { measureTools2 } from "./measurespace.js";
import { modifyTools } from "./modify.js";
import { optimiseTools } from "./optimise.js";
import { organiseTools } from "./organise.js";
import { planTools } from "./plan.js";
import { renderTools } from "./render.js";
import { reportTools } from "./report.js";
import { sceneTools } from "./scene.js";
import { solidTools } from "./solids.js";
import { spaceTools } from "./space.js";
import { vertexTools } from "./vertex.js";
import { visleafTools } from "./visleaf.js";
import { vmfTools } from "./vmf.js";
import { vmfEditTools } from "./vmfedit.js";
import { wiringTools } from "./wiring.js";

export const allTools: AnyToolDef[] = [
  ...healthTools,
  ...gameTools,
  ...bspTools,
  ...measureTools,
  ...materialsTools,
  ...lightmapTools,
  ...visleafTools,
  ...reportTools,
  ...vmfTools,
  ...contentTools,
  ...solidTools,
  ...spaceTools,
  ...sceneTools,
  ...measureTools2,
  ...renderTools,
  ...planTools,
  ...displacementTools,
  ...buildTools,
  ...modifyTools,
  ...clipTools,
  ...vertexTools,
  ...hollowTools,
  ...faceTools,
  ...organiseTools,
  ...optimiseTools,
  ...depsTools,
  ...gmaTools,
  ...wiringTools,
  ...vmfEditTools,
  ...compileTools,
  ...lmpTools,
];

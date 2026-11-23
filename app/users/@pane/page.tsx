import PaneSlot from "./[...rest]/page";

export const dynamic = "force-dynamic";

// v1.83.0 (D-410): Home (/users) itself; every other /users address uses
// [...rest] (Next matches catch-all slots, not optional catch-all ones).
export default PaneSlot;

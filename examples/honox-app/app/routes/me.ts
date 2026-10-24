import { createRoute } from "honox/factory";

export default createRoute((c) => c.json({ uid: c.get("uid") }));

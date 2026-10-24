import { createRoute } from "honox/factory";

export default createRoute((c) => c.text("honox-app: GET /health、GET /me、GET /plans/:id"));

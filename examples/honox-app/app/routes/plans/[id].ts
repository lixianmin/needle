import { ResponseX } from "@needle/shell";
import { createRoute } from "honox/factory";
import { planSheet } from "../../lib/plans";

export default createRoute((c) => {
  const id = Number(c.req.param("id"));
  const plan = Number.isFinite(id) ? planSheet.get(id) : undefined;
  if (plan === undefined) {
    return ResponseX.notFound("plan 不存在");
  }
  return c.json(plan);
});

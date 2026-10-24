import { defineSheet } from "@needle/honox/excel";

/** 一张 sheet 一个句柄：id 是数字，其余列原样保留。 */
export const planSheet = defineSheet<{ id: number; name: string; quota: number }>({
  file: "res/metadata/Plan.xlsx",
  sheet: "Plan",
});

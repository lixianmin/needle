/**
 * 定义一张表：列顺序、表头、列语义各写一次，之后只塞行对象。
 *
 * 列顺序来自这里 key 的插入顺序（对象字面量的字符串 key 有序；别用 "1"
 * 这类整数样式的 key，它们会被排到前面）。行对象的 key 顺序无关紧要，
 * 取值是按 key 取的。
 *
 * `T` 与 schema 双向约束：schema 少一个字段、行对象少一个字段、或多出
 * schema 里没有的字段，`tsc` 都直接报错——不会出现列名与每行数据错位。
 */
export function table(schema) {
    const keys = Object.keys(schema);
    const columns = keys.map((key) => schema[key].title ?? key);
    const formats = keys.map((key) => schema[key].format ?? "auto");
    return {
        output(rows) {
            return {
                kind: "table",
                columns,
                // 缺字段（schema 与行类型不一致时 tsc 已经拦了）按空格子处理。
                rows: rows.map((row) => keys.map((key) => row[key] ?? null)),
                formats,
            };
        },
    };
}

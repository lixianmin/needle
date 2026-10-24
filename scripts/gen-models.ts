/**
 * model class → TypeBox schema 生成器。
 *
 * 用法：bun scripts/gen-models.ts <model 文件...>
 *
 * 手写的 class 是唯一真值；生成物（`*.generated.ts`）提交进仓库，pre-commit 重建。
 * 生成物里带一条漂移断言：class 改了没重新生成，`tsc` 会直接报错。
 *
 * 支持的字段类型：标量、`T[]` / `Array<T>`、同文件与跨文件 class 嵌套、`?` 可选、`Date`。
 * 其余（方法 / getter / 装饰器 / 泛型 / 任意联合 / 递归）一律报错，不静默降级——
 * 悄悄生成一个 `Type.Any()` 比生成失败危险得多。
 *
 * 解析器用 `typescript-6`（npm 别名 typescript@6）：项目编译器是 7.0（native）,
 * 它不提供 `createSourceFile` 这类 AST API。
 */
import ts from "typescript-6";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

const SCALARS: Partial<Record<ts.SyntaxKind, string>> = {
  [ts.SyntaxKind.NumberKeyword]: "Type.Number()",
  [ts.SyntaxKind.StringKeyword]: "Type.String()",
  [ts.SyntaxKind.BooleanKeyword]: "Type.Boolean()",
};

interface Model {
  name: string;
  file: string;
  source: ts.SourceFile;
  decl: ts.ClassDeclaration;
  deps: string[];
}

function die(message: string): never {
  throw new GenError(message);
}

class GenError extends Error {}

function isEmpty(value: string | undefined): boolean {
  return value === undefined || value === "";
}

/** 数组 / 可选 / 联合先剥掉，剩下的如果是 model 引用就把名字报出来。 */
function classOfField(node: ts.TypeNode, models: Map<string, Model>, where: string): string | undefined {
  if (ts.isArrayTypeNode(node)) {
    return classOfField(node.elementType, models, where);
  }
  if (ts.isUnionTypeNode(node)) {
    const rest = node.types.filter((type) => type.kind !== ts.SyntaxKind.UndefinedKeyword);
    if (rest.length !== 1) {
      die(`${where}：不支持的联合类型 ${node.getText()}`);
    }
    return classOfField(rest[0] as ts.TypeNode, models, where);
  }
  if (ts.isTypeReferenceNode(node)) {
    const name = node.typeName.getText();
    if (name === "Array") {
      const arg = node.typeArguments?.[0];
      if (arg === undefined) {
        die(`${where}：Array<T> 缺少类型参数`);
      }
      return classOfField(arg, models, where);
    }
    if (name === "Date") {
      return undefined;
    }
    if (!models.has(name)) {
      die(`${where}：引用了未知类型 ${name}（只认已声明的 model class）`);
    }
    return name;
  }
  return undefined;
}

function typeExpr(node: ts.TypeNode, models: Map<string, Model>, where: string): string {
  const scalar = SCALARS[node.kind];
  if (scalar !== undefined) {
    return scalar;
  }
  if (ts.isArrayTypeNode(node)) {
    return `Type.Array(${typeExpr(node.elementType, models, where)})`;
  }
  if (ts.isUnionTypeNode(node)) {
    const rest = node.types.filter((type) => type.kind !== ts.SyntaxKind.UndefinedKeyword);
    if (rest.length !== 1) {
      die(`${where}：不支持的联合类型 ${node.getText()}`);
    }
    return typeExpr(rest[0] as ts.TypeNode, models, where);
  }
  if (ts.isTypeReferenceNode(node)) {
    const name = node.typeName.getText();
    if (name === "Array") {
      const arg = node.typeArguments?.[0];
      if (arg === undefined) {
        die(`${where}：Array<T> 缺少类型参数`);
      }
      return `Type.Array(${typeExpr(arg, models, where)})`;
    }
    if (name === "Date") {
      return 'Type.String({ format: "date-time" })';
    }
    return `${name}Schema`;
  }
  return die(`${where}：不支持的类型 ${node.getText()}`);
}

function collect(files: readonly string[]): Map<string, Model> {
  const models = new Map<string, Model>();
  for (const file of files) {
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.ES2022, true);
    for (const statement of source.statements) {
      if (!ts.isClassDeclaration(statement) || statement.name === undefined) {
        continue;
      }
      const name = statement.name.getText();
      if (models.has(name)) {
        die(`模型重名：${name}（${models.get(name)?.file} 与 ${file}）`);
      }
      models.set(name, { name, file, source, decl: statement, deps: [] });
    }
  }
  if (models.size === 0) {
    die("没有找到任何 model class");
  }
  return models;
}

function validate(models: Map<string, Model>): void {
  for (const model of models.values()) {
    for (const member of model.decl.members) {
      if (!ts.isPropertyDeclaration(member)) {
        die(`${model.name}：只支持字段声明，${member.getText()} 不支持`);
      }
      if (member.type === undefined) {
        die(`${model.name}.${member.name.getText()}：字段必须有类型标注（写成 ids = [] 读不到类型）`);
      }
      const line = model.source.getLineAndCharacterOfPosition(member.getStart()).line + 1;
      const where = `${basename(model.file)}:${line} ${model.name}.${member.name.getText()}`;
      typeExpr(member.type, models, where);
      const dep = classOfField(member.type, models, where);
      if (dep !== undefined) {
        model.deps.push(dep);
      }
    }
  }
}

/** 递归结构要手写 schema（`Type.Recursive`），这里只认无环图。 */
function assertAcyclic(models: Map<string, Model>): void {
  const done = new Set<string>();
  const visit = (name: string, stack: string[]): void => {
    if (stack.includes(name)) {
      die(`循环引用：${[...stack, name].join(" → ")}（递归结构要手写 schema）`);
    }
    if (done.has(name)) {
      return;
    }
    for (const dep of models.get(name)?.deps ?? []) {
      visit(dep, [...stack, name]);
    }
    done.add(name);
  };
  for (const name of models.keys()) {
    visit(name, []);
  }
}

/** 依赖在前：同文件的 `const` 有 TDZ，顺序错了模块初始化就炸。 */
function orderedFor(models: readonly Model[], file: string): Model[] {
  const ordered: Model[] = [];
  const done = new Set<string>();
  const emit = (model: Model): void => {
    if (done.has(model.name)) {
      return;
    }
    for (const dep of model.deps) {
      const depModel = models.find((candidate) => candidate.name === dep);
      if (depModel !== undefined && depModel.file === file) {
        emit(depModel);
      }
    }
    done.add(model.name);
    ordered.push(model);
  };
  for (const model of models) {
    if (model.file === file) {
      emit(model);
    }
  }
  return ordered;
}

function render(file: string, ordered: readonly Model[], all: readonly Model[]): string {
  const foreign = new Map<string, string>();
  for (const model of ordered) {
    for (const dep of model.deps) {
      const depModel = all.find((candidate) => candidate.name === dep);
      if (depModel !== undefined && depModel.file !== file) {
        foreign.set(dep, `./${basename(depModel.file).replace(/\.ts$/, ".generated.js")}`);
      }
    }
  }

  const fields = ordered.map((model) => {
    const lines = model.decl.members.filter(ts.isPropertyDeclaration).map((member) => {
      const optional =
        member.questionToken !== undefined ||
        (member.type !== undefined &&
          ts.isUnionTypeNode(member.type) &&
          member.type.types.some((type) => type.kind === ts.SyntaxKind.UndefinedKeyword));
      const expr = typeExpr(member.type as ts.TypeNode, new Map(all.map((m) => [m.name, m])), model.name);
      const name = member.name.getText();
      return `  ${name}: ${optional ? `Type.Optional(${expr})` : expr},`;
    });
    return `export const ${model.name}Schema = Type.Object({\n${lines.join("\n")}\n}, { additionalProperties: false });`;
  });

  const imports = [...foreign.entries()]
    .map(([name, target]) => `import { ${name}Schema } from "${target}";`)
    .join("\n");

  return `// 由 scripts/gen-models.ts 生成，勿手改。
import { Type, type Static } from "@sinclair/typebox";
import type { ${ordered.map((model) => model.name).join(", ")} } from "./${basename(file).replace(/\.ts$/, ".js")}";
${isEmpty(imports) ? "" : `${imports}\n`}
${fields.join("\n\n")}

// 漂移断言：class 改了没重新生成，tsc 会在这里报错。
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;
${ordered.map((model) => `type _${model.name}InSync = Assert<Equals<Static<typeof ${model.name}Schema>, ${model.name}>>;`).join("\n")}
`;
}

function main(files: readonly string[]): void {
  const models = collect(files);
  validate(models);
  assertAcyclic(models);
  const all = [...models.values()];
  for (const file of new Set(all.map((model) => model.file))) {
    const ordered = orderedFor(all, file);
    writeFileSync(resolve(dirname(file), `${basename(file, ".ts")}.generated.ts`), render(file, ordered, all));
  }
}

try {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    die("用法：bun scripts/gen-models.ts <model 文件...>");
  }
  main(files);
} catch (error) {
  if (error instanceof GenError) {
    console.error(`gen-models: ${error.message}`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}

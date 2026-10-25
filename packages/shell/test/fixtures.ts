/**
 * 测试里用的固定版本号。
 *
 * 这些测试要断言的是"版本号被原样透传进 handshake / 页面"，具体值是几无关。
 * 所以固定一个常量，而不是读 `package.json`：改版本号不该弄红测试。
 * 真实读版本号的写法见 `examples/shell-demo.ts`。
 */
export const TEST_VERSION = "0.1.0";

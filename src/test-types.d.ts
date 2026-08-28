/**
 * 让 jest-dom 的 expect 增强（toHaveTextContent / toBeDisabled / toHaveClass 等）
 * 在整个 tsconfig 程序内生效。
 *
 * 必须放在 src/ 下而不是 tests/：Docker 构建上下文经 .dockerignore 排除了 tests/，
 * 而 next build 的类型检查仍覆盖 src 目录下的测试文件——如果增强只由 tests/setup.ts
 * 引入，容器内构建会报 TS2339（Property 'toXxx' does not exist on type 'Assertion'）。
 * 这个 d.ts 只影响类型层，不会进入任何运行时代码。
 */
import '@testing-library/jest-dom/vitest';

// Minimale React-Typen NUR für die Typprüfung in dieser Build-Umgebung (ohne Internet war @types/react
// nicht installierbar). Auf einem normalen Rechner: `npm install` bringt die vollständigen Typen.
/* eslint-disable @typescript-eslint/no-explicit-any */
declare module 'react' {
  export type ReactNode = any;
  type SetState<T> = (v: T | ((prev: T) => T)) => void;
  export function useState<T>(init: T | (() => T)): [T, SetState<T>];
  export function useEffect(fn: () => void | (() => void), deps?: unknown[]): void;
  export function useCallback<T extends (...a: any[]) => any>(fn: T, deps: unknown[]): T;
  export function useRef<T>(init: T): { current: T };
}
declare module 'react-dom/client' {
  export function createRoot(el: Element): { render(node: any): void };
}
declare module 'react/jsx-runtime' {
  export const jsx: any;
  export const jsxs: any;
  export const Fragment: any;
  export namespace JSX {
    type Element = any;
    interface IntrinsicElements {
      [tag: string]: any;
    }
    interface IntrinsicAttributes {
      key?: string | number;
    }
    interface ElementChildrenAttribute {
      children: {};
    }
  }
}

declare namespace JSX {
  interface IntrinsicElements {
    [elementName: string]: any;
  }
}

declare module "react" {
  export type Dispatch<A> = (value: A) => void;
  export type SetStateAction<S> = S | ((previousState: S) => S);
  export function useMemo<T>(factory: () => T, deps: unknown[]): T;
  export function useState<S>(initialState: S): [S, Dispatch<SetStateAction<S>>];
  const React: {
    StrictMode: any;
  };
  export default React;
}

declare module "react-dom/client" {
  export function createRoot(container: Element): {
    render(children: any): void;
  };
}

declare module "react/jsx-runtime" {
  export const jsx: any;
  export const jsxs: any;
  export const Fragment: any;
}

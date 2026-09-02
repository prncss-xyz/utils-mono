export type Teardown = (() => void) | void
export type OnMount = () => Teardown

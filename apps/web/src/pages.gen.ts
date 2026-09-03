// deno-fmt-ignore-file
// biome-ignore format: generated types do not need formatting
// prettier-ignore
import type { PathsForPages, GetConfigResponse, SearchCodecsForPages } from 'waku/router';

// prettier-ignore
import type { getConfig as File_Root_getConfig } from './pages/_root';
// prettier-ignore
import type { getConfig as File_Dialog_getConfig } from './pages/dialog';
// prettier-ignore
import type { getConfig as File_Index_getConfig } from './pages/index';
// prettier-ignore
import type { getConfig as File_Multisteps_getConfig } from './pages/multisteps';
// prettier-ignore
import type { getConfig as File_Store_getConfig } from './pages/store';

// prettier-ignore
type Page =
| ({ path: '/_root' } & GetConfigResponse<typeof File_Root_getConfig>)
| ({ path: '/dialog' } & GetConfigResponse<typeof File_Dialog_getConfig>)
| ({ path: '/' } & GetConfigResponse<typeof File_Index_getConfig>)
| ({ path: '/multisteps' } & GetConfigResponse<typeof File_Multisteps_getConfig>)
| ({ path: '/store' } & GetConfigResponse<typeof File_Store_getConfig>);

// prettier-ignore
declare module 'waku/router' {
  interface RouteConfig {
    paths: PathsForPages<Page>;
  }
  interface CreatePagesConfig {
    pages: Page;
  }
  interface SearchCodecsConfig extends SearchCodecsForPages<Page> {}
}

import { ModuleWithProviders, NgModule } from '@angular/core';


@NgModule({

})
export class FsWebSocketModule {
  static forRoot(): ModuleWithProviders<FsWebSocketModule> {
    return {
      ngModule: FsWebSocketModule,
    };
  }
}

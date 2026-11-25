import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter, withInMemoryScrolling } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { routes } from './app.routes';
import { AuthService } from './core/auth/auth.service';
import { apiErrorInterceptor } from './core/http/api-error.interceptor';
import { authInterceptor } from './core/http/auth.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(
      routes,
      withInMemoryScrolling({ anchorScrolling: 'enabled', scrollPositionRestoration: 'enabled' }),
    ),
    // Order matters: apiError is outermost, auth is inner so it sees the raw HTTP status.
    provideHttpClient(withFetch(), withInterceptors([apiErrorInterceptor, authInterceptor])),
    provideAppInitializer(() => firstValueFrom(inject(AuthService).loadMe())),
  ],
};

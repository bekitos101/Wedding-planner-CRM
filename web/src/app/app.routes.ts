import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/auth/auth.guard';

export const routes: Routes = [
  // Public guest page: outside the planner shell, no auth.
  {
    path: 'rsvp/:token',
    loadComponent: () => import('./rsvp/rsvp-page.component').then((m) => m.RsvpPageComponent),
  },
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/login.page').then((m) => m.LoginPage),
  },
  {
    path: 'register',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/register.page').then((m) => m.RegisterPage),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./layout/shell.component').then((m) => m.ShellComponent),
    children: [
      {
        path: '',
        pathMatch: 'full',
        loadComponent: () => import('./home/home.component').then((m) => m.HomeComponent),
      },
      {
        path: 'profile',
        loadComponent: () => import('./features/profile/profile.page').then((m) => m.ProfilePage),
      },
    ],
  },
  {
    path: '**',
    loadComponent: () =>
      import('./not-found/not-found.component').then((m) => m.NotFoundComponent),
  },
];

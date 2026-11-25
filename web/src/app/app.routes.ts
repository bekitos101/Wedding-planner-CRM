import { Routes } from '@angular/router';
import { authGuard, guestGuard, landingGuard } from './core/auth/auth.guard';
import { editableGuard, ownerGuard } from './features/weddings/wedding.guards';

export const routes: Routes = [
  // Public guest page: outside the planner shell, no auth.
  {
    path: 'rsvp/:token',
    loadComponent: () => import('./rsvp/rsvp-page.component').then((m) => m.RsvpPageComponent),
  },
  // Public pages share one layout (header + footer).
  {
    path: '',
    loadComponent: () =>
      import('./core/layout/public-layout.component').then((m) => m.PublicLayoutComponent),
    children: [
      {
        path: '',
        pathMatch: 'full',
        canActivate: [landingGuard],
        loadComponent: () => import('./features/landing/landing.page').then((m) => m.LandingPage),
      },
      {
        path: 'contact',
        loadComponent: () => import('./features/contact/contact.page').then((m) => m.ContactPage),
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
    ],
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./layout/shell.component').then((m) => m.ShellComponent),
    children: [
      {
        path: 'weddings',
        pathMatch: 'full',
        loadComponent: () =>
          import('./features/weddings/weddings-list.page').then((m) => m.WeddingsListPage),
      },
      {
        path: 'weddings/new',
        loadComponent: () =>
          import('./features/weddings/wedding-form.page').then((m) => m.WeddingFormPage),
      },
      {
        path: 'weddings/:weddingId',
        loadComponent: () =>
          import('./features/weddings/wedding-area.component').then((m) => m.WeddingAreaComponent),
        children: [
          {
            path: '',
            pathMatch: 'full',
            loadComponent: () =>
              import('./features/weddings/wedding-overview.page').then((m) => m.WeddingOverviewPage),
          },
          {
            path: 'edit',
            canActivate: [editableGuard],
            loadComponent: () =>
              import('./features/weddings/wedding-form.page').then((m) => m.WeddingFormPage),
          },
          {
            path: 'team',
            canActivate: [ownerGuard],
            loadComponent: () => import('./features/weddings/team.page').then((m) => m.TeamPage),
          },
          {
            path: 'guests',
            loadComponent: () => import('./features/guests/guests.page').then((m) => m.GuestsPage),
          },
          {
            path: 'tasks',
            loadComponent: () => import('./features/tasks/tasks.page').then((m) => m.TasksPage),
          },
          {
            path: 'budget',
            loadComponent: () => import('./features/budget/budget.page').then((m) => m.BudgetPage),
          },
          {
            path: 'budget/:expenseId',
            loadComponent: () => import('./features/budget/expense-detail.page').then((m) => m.ExpenseDetailPage),
          },
          {
            path: 'suppliers',
            loadComponent: () => import('./features/suppliers/suppliers.page').then((m) => m.SuppliersPage),
          },
          {
            path: 'schedule',
            loadComponent: () => import('./features/schedule/schedule.page').then((m) => m.SchedulePage),
          },
        ],
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
      import('./core/layout/public-layout.component').then((m) => m.PublicLayoutComponent),
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./not-found/not-found.component').then((m) => m.NotFoundComponent),
      },
    ],
  },
];

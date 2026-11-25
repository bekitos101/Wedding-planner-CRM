import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../core/auth/auth.service';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <header class="topbar">
      <a routerLink="/" class="brand">Wedding Organizer</a>
      <span class="spacer"></span>
      @if (auth.currentUser(); as user) {
        <a routerLink="/profile" class="user">{{ user.name }}</a>
        <button type="button" class="btn btn-outline" (click)="logout()">Log out</button>
      }
    </header>
    <div class="body">
      <nav class="sidenav" aria-label="Main">
        <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">Weddings</a>
        <a routerLink="/profile" routerLinkActive="active">Profile</a>
      </nav>
      <main class="content"><router-outlet /></main>
    </div>
  `,
  styles: `
    :host { display: flex; flex-direction: column; min-height: 100vh; }
    .topbar { background: var(--color-primary); color: #fff; padding: 0.75rem 1.25rem; display: flex; align-items: center; gap: 1rem; }
    .spacer { flex: 1; }
    .brand, .user { color: #fff; text-decoration: none; }
    .brand { font-weight: 600; font-size: 1.1rem; }
    .body { display: flex; flex: 1; }
    .sidenav { width: 13rem; background: var(--color-surface); border-right: 1px solid var(--color-border); padding: 1rem 0.5rem; display: flex; flex-direction: column; gap: 0.25rem; }
    .sidenav a { padding: 0.5rem 0.75rem; border-radius: 6px; color: var(--color-text); text-decoration: none; }
    .sidenav a:hover { background: var(--color-bg); }
    .sidenav a.active { background: var(--color-primary); color: #fff; }
    .content { flex: 1; padding: 1.5rem; min-width: 0; }
  `,
})
export class ShellComponent {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  logout(): void {
    this.auth.logout().subscribe(() => void this.router.navigateByUrl('/login'));
  }
}

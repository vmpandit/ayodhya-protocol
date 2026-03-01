// ── Ayodhya Protocol: Lanka Reforged ── HUD Manager ──

import { PlayerState, BossState, BossPhase, PlayerStatus } from '@shared/types';

export class HUD {
  private hpBar: HTMLElement;
  private hpLabel: HTMLElement;
  private staminaBar: HTMLElement;
  private staminaLabel: HTMLElement;
  private bossBar: HTMLElement;
  private bossHpFill: HTMLElement;
  private bossPhaseLabel: HTMLElement;
  private teamBarsContainer: HTMLElement;
  private cdFireOverlay: HTMLElement;
  private cdShockwaveOverlay: HTMLElement;
  private downedOverlay: HTMLElement;
  private gameOverScreen: HTMLElement;
  private gameOverTitle: HTMLElement;
  private notifications: HTMLElement;
  private damageFlashTimeout = 0;

  constructor() {
    this.hpBar = document.getElementById('hpBar')!;
    this.hpLabel = document.getElementById('hpLabel')!;
    this.staminaBar = document.getElementById('staminaBar')!;
    this.staminaLabel = document.getElementById('staminaLabel')!;
    this.bossBar = document.getElementById('bossBar')!;
    this.bossHpFill = document.getElementById('bossHpFill')!;
    this.bossPhaseLabel = document.getElementById('bossPhaseLabel')!;
    this.teamBarsContainer = document.getElementById('teamBars')!;
    this.cdFireOverlay = document.getElementById('cdFireOverlay')!;
    this.cdShockwaveOverlay = document.getElementById('cdShockwaveOverlay')!;
    this.downedOverlay = document.getElementById('downedOverlay')!;
    this.gameOverScreen = document.getElementById('gameOverScreen')!;
    this.gameOverTitle = document.getElementById('gameOverTitle')!;
    this.notifications = document.getElementById('notifications')!;
  }

  updatePlayerBars(hp: number, maxHp: number, stamina: number): void {
    const hpPct = Math.max(0, (hp / maxHp) * 100);
    this.hpBar.style.width = `${hpPct}%`;
    this.hpLabel.textContent = `${Math.round(hp)} / ${Math.round(maxHp)}`;

    const stPct = Math.max(0, (stamina / 100) * 100);
    this.staminaBar.style.width = `${stPct}%`;
    this.staminaLabel.textContent = `${Math.round(stamina)} / 100`;
  }

  updateTeamBars(players: PlayerState[], localId: number): void {
    const others = players.filter(p => p.id !== localId);

    // Create/update team bars
    while (this.teamBarsContainer.children.length < others.length) {
      const bar = document.createElement('div');
      bar.className = 'team-bar';
      bar.innerHTML = `
        <div class="team-name">P?</div>
        <div class="team-hp"><div class="team-hp-fill"></div></div>
      `;
      this.teamBarsContainer.appendChild(bar);
    }
    while (this.teamBarsContainer.children.length > others.length) {
      this.teamBarsContainer.removeChild(this.teamBarsContainer.lastChild!);
    }

    for (let i = 0; i < others.length; i++) {
      const p = others[i];
      const el = this.teamBarsContainer.children[i] as HTMLElement;
      const name = el.querySelector('.team-name') as HTMLElement;
      const fill = el.querySelector('.team-hp-fill') as HTMLElement;
      name.textContent = `P${p.id}`;
      const pct = Math.max(0, (p.hp / p.maxHp) * 100);
      fill.style.width = `${pct}%`;

      if (p.status === PlayerStatus.Downed) {
        fill.style.background = '#ff4444';
      } else {
        fill.style.background = '#2ecc71';
      }
    }
  }

  updateBossBar(boss: BossState): void {
    this.bossBar.classList.add('visible');
    const pct = Math.max(0, (boss.hp / boss.maxHp) * 100);
    this.bossHpFill.style.width = `${pct}%`;

    const phaseNames: Record<number, string> = {
      [BossPhase.Phase1]: 'Phase I',
      [BossPhase.Phase2]: 'Phase II — Ascended',
      [BossPhase.Phase3Enrage]: 'Phase III — ENRAGE',
      [BossPhase.Dead]: 'DEFEATED',
    };
    this.bossPhaseLabel.textContent = phaseNames[boss.phase] || '';

    if (boss.phase === BossPhase.Phase3Enrage) {
      this.bossHpFill.style.background = 'linear-gradient(90deg, #8b0000, #ff0000)';
      this.bossPhaseLabel.style.color = '#ff4444';
    } else {
      this.bossHpFill.style.background = 'linear-gradient(90deg, #8b0000, #ff4444)';
      this.bossPhaseLabel.style.color = '#ff8888';
    }
  }

  updateCooldowns(fireArrowPct: number, shockwavePct: number): void {
    this.cdFireOverlay.style.height = `${fireArrowPct * 100}%`;
    this.cdShockwaveOverlay.style.height = `${shockwavePct * 100}%`;
  }

  updateDownedState(isDowned: boolean): void {
    if (isDowned) {
      this.downedOverlay.classList.add('visible');
    } else {
      this.downedOverlay.classList.remove('visible');
    }
  }

  flashDamage(): void {
    const canvas = document.getElementById('renderCanvas')!;
    canvas.style.boxShadow = 'inset 0 0 80px rgba(255,0,0,0.4)';
    clearTimeout(this.damageFlashTimeout);
    this.damageFlashTimeout = window.setTimeout(() => {
      canvas.style.boxShadow = 'none';
    }, 200);
  }

  showNotification(text: string): void {
    const el = document.createElement('div');
    el.className = 'notif';
    el.textContent = text;
    this.notifications.appendChild(el);
    setTimeout(() => el.remove(), 2000);
  }

  showGameOver(won: boolean): void {
    this.gameOverScreen.classList.add('visible');
    this.gameOverTitle.textContent = won ? 'VICTORY' : 'DEFEAT';
    this.gameOverTitle.className = won ? 'victory' : 'defeat';
  }
}

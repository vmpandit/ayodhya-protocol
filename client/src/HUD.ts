// ── Ayodhya Protocol: Lanka Reforged ── HUD Manager ──
// Polish pass: kill feed, combo counter, screen transitions, settings panel.

import { PlayerState, BossState, BossPhase, PlayerStatus, SpecialArrowType } from '@shared/types';

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
  private damageVignette: HTMLElement;
  private killFeed: HTMLElement;
  private comboEl: HTMLElement;
  private comboCountEl: HTMLElement;
  private arrowAlert: HTMLElement;
  private arrowSelector: HTMLElement;
  private arrowSlots: HTMLElement[] = [];

  // ── Combo tracking ────────────────────────────────────────
  private comboCount = 0;
  private comboTimer = 0;
  private readonly COMBO_WINDOW = 3.0; // seconds to maintain combo

  // ── Arrow alert ────────────────────────────────────────────
  private alertTimer = 0;

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
    this.damageVignette = document.getElementById('damageVignette')!;
    this.killFeed = document.getElementById('killFeed')!;
    this.comboEl = document.getElementById('comboDisplay')!;
    this.comboCountEl = document.getElementById('comboCount')!;
    this.arrowAlert = document.getElementById('arrowAlert')!;
    this.arrowSelector = document.getElementById('arrowSelector')!;

    // Cache arrow slot elements
    for (let i = 0; i < 5; i++) {
      const slot = document.getElementById(`arrowSlot${i}`);
      if (slot) this.arrowSlots.push(slot);
    }
  }

  /** Call every frame to decay combo timer and arrow alert */
  update(dt: number): void {
    if (this.comboCount > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) {
        this.comboCount = 0;
        this.comboEl.classList.remove('visible');
      }
    }
    // Decay arrow alert
    if (this.alertTimer > 0) {
      this.alertTimer -= dt;
      if (this.alertTimer <= 0) {
        this.arrowAlert.classList.remove('visible');
      }
    }
  }

  updatePlayerBars(hp: number, maxHp: number, stamina: number): void {
    const hpPct = Math.max(0, (hp / maxHp) * 100);
    this.hpBar.style.width = `${hpPct}%`;
    this.hpLabel.textContent = `${Math.round(hp)} / ${Math.round(maxHp)}`;

    // Low health pulse
    if (hpPct <= 25) {
      this.hpBar.style.animation = 'lowHpPulse 0.6s infinite';
    } else {
      this.hpBar.style.animation = '';
    }

    const stPct = Math.max(0, (stamina / 100) * 100);
    this.staminaBar.style.width = `${stPct}%`;
    this.staminaLabel.textContent = `${Math.round(stamina)} / 100`;
  }

  updateTeamBars(players: PlayerState[], localId: number): void {
    const others = players.filter(p => p.id !== localId);

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
      fill.style.background = p.status === PlayerStatus.Downed ? '#ff4444' : '#2ecc71';
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
    this.damageVignette.classList.remove('flash');
    void this.damageVignette.offsetWidth;
    this.damageVignette.classList.add('flash');
  }

  /** Increment combo counter (call when player lands a hit on enemy/boss). */
  registerHit(): void {
    this.comboCount++;
    this.comboTimer = this.COMBO_WINDOW;
    this.comboCountEl.textContent = `${this.comboCount}`;
    this.comboEl.classList.add('visible');

    // Pulse animation
    this.comboCountEl.classList.remove('pop');
    void this.comboCountEl.offsetWidth;
    this.comboCountEl.classList.add('pop');
  }

  /** Add a message to the kill feed. */
  addKillFeedEntry(text: string, color = '#ffd700'): void {
    const entry = document.createElement('div');
    entry.className = 'kill-feed-entry';
    entry.textContent = text;
    entry.style.color = color;
    this.killFeed.appendChild(entry);

    // Remove after animation ends
    setTimeout(() => entry.remove(), 4000);

    // Max 5 entries visible
    while (this.killFeed.children.length > 5) {
      this.killFeed.removeChild(this.killFeed.firstChild!);
    }
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

  /** Get current combo count for scoring/feedback. */
  getComboCount(): number { return this.comboCount; }

  /** Flash an enemy special arrow alert on screen. */
  showArrowAlert(arrowName: string): void {
    this.arrowAlert.textContent = `⚠ ${arrowName} INCOMING!`;
    this.arrowAlert.classList.add('visible');
    this.alertTimer = 1.5; // seconds
  }

  /** Update the special arrow selector bar to highlight the selected arrow. */
  updateArrowSelector(selected: SpecialArrowType, cooldowns: number[]): void {
    for (let i = 0; i < this.arrowSlots.length; i++) {
      const slot = this.arrowSlots[i];
      slot.classList.toggle('selected', i === (selected as number));
      const cdOverlay = slot.querySelector('.arrow-cd-fill') as HTMLElement;
      if (cdOverlay) {
        cdOverlay.style.height = `${(cooldowns[i] || 0) * 100}%`;
      }
    }
  }
}

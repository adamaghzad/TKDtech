export type DesktopLicenseState = 'NOT_REQUIRED' | 'UNLICENSED' | 'ACTIVE' | 'EXPIRED' | 'DEVICE_MISMATCH' | 'NOT_YET_VALID' | 'INVALID';

export interface DesktopLicenseStatus {
  required: boolean;
  status: DesktopLicenseState;
  installationCode: string;
  binding: 'MACHINE_AND_INSTALLATION' | 'INSTALLATION_ONLY';
  canStartNewWork: boolean;
  canFinishActiveTournament: boolean;
  serverTime: string;
  message: string | null;
  license: {
    licenseId: string;
    clubName: string;
    plan: 'FOUNDING_CLUB' | 'CLUB' | 'TOURNAMENT_SUPPORT' | 'SALLE' | 'SALLE_PLUS';
    issuedAt: string;
    expiresAt: string;
    daysRemaining: number;
  } | null;
  capabilities?: {
    registrations: boolean;
    draws: boolean;
    podium: boolean;
    reports: boolean;
    fullJudgingPanel: boolean;
  };
}

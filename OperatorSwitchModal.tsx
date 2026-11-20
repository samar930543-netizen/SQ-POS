import React, { useState, useEffect } from 'react';
import { RolePermissionMatrix, StaffMember } from '../types';
import {
  STAFF_PERMISSION_DEFINITIONS,
  countGrantedPermissions,
  getEffectiveStaffPermissions,
} from '../utils/staffRbac';
import { soundManager } from '../utils/soundEffects';
import {
  X,
  UserCheck,
  Lock,
  ShieldCheck,
  Check,
  AlertCircle,
  KeyRound,
} from 'lucide-react';

interface OperatorSwitchModalProps {
  isOpen: boolean;
  onClose: () => void;
  staffMembers: StaffMember[];
  activeStaff: StaffMember | null;
  rolePermissions: RolePermissionMatrix;
  onSwitchOperator: (staff: StaffMember) => void;
  onOpenTeamTab?: () => void;
}

export const OperatorSwitchModal: React.FC<OperatorSwitchModalProps> = ({
  isOpen,
  onClose,
  staffMembers,
  activeStaff,
  rolePermissions,
  onSwitchOperator,
  onOpenTeamTab,
}) => {
  const [pendingTarget, setPendingTarget] = useState<StaffMember | null>(null);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setPendingTarget(null);
      setPinInput('');
      setPinError(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const activeMembers = staffMembers.filter(m => m.active);
  const inactiveMembers = staffMembers.filter(m => !m.active);

  const handleSelectMember = (member: StaffMember) => {
    if (activeStaff?.id === member.id) {
      onClose();
      return;
    }

    if (member.pin && member.pin.trim().length > 0) {
      soundManager.playMechanicalClick();
      setPendingTarget(member);
      setPinInput('');
      setPinError(null);
      return;
    }

    soundManager.playCheckoutSuccess();
    onSwitchOperator(member);
    onClose();
  };

  const handlePinVerify = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingTarget) return;
    if (pinInput.trim() === (pendingTarget.pin || '').trim()) {
      soundManager.playCheckoutSuccess();
      onSwitchOperator(pendingTarget);
      onClose();
    } else {
      soundManager.playAlertSound();
      setPinError('Incorrect operator PIN. Please try again.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg max-h-[90vh] flex flex-col bg-slate-900 border border-slate-700 rounded-2xl text-slate-100 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-blue-400" />
              Switch Active POS Operator
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Orders, inventory actions &amp; module permissions follow the active operator
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
            aria-label="Close operator switcher"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {pendingTarget ? (
            <form
              onSubmit={handlePinVerify}
              className="p-4 rounded-xl bg-slate-950 border border-blue-500/40 space-y-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs text-blue-300 font-semibold">PIN Verification Required</div>
                  <div className="text-sm font-bold text-white mt-0.5">
                    {pendingTarget.name}{' '}
                    <span className="text-xs font-normal text-slate-400">
                      · {pendingTarget.role}
                    </span>
                  </div>
                </div>
                <KeyRound className="w-5 h-5 text-blue-400 flex-shrink-0" />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Enter Operator PIN
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  autoFocus
                  maxLength={8}
                  value={pinInput}
                  onChange={e => {
                    setPinInput(e.target.value);
                    if (pinError) setPinError(null);
                  }}
                  placeholder="Enter 4-digit PIN"
                  className="w-full px-3 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white font-mono text-base tracking-widest focus:outline-none focus:border-blue-500"
                />
                {pendingTarget.id === 'staff_owner' && (
                  <p className="text-[11px] text-slate-500 mt-1">
                    Default demo Owner PIN is <span className="font-mono text-slate-300">1234</span>{' '}
                    (Cashier Mohan: <span className="font-mono text-slate-300">1111</span>)
                  </p>
                )}
              </div>

              {pinError && (
                <div className="p-2 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>{pinError}</span>
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setPendingTarget(null);
                    setPinInput('');
                    setPinError(null);
                  }}
                  className="flex-1 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold"
                >
                  Back
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold"
                >
                  Unlock &amp; Switch
                </button>
              </div>
            </form>
          ) : (
            <>
              <div className="space-y-2">
                {activeMembers.map(member => {
                  const isCurrent = activeStaff?.id === member.id;
                  const perms = getEffectiveStaffPermissions(member, rolePermissions);
                  const grantedCount = countGrantedPermissions(perms);
                  const totalCount = STAFF_PERMISSION_DEFINITIONS.length;
                  const grantedLabels = STAFF_PERMISSION_DEFINITIONS.filter(d => perms[d.key])
                    .slice(0, 4)
                    .map(d => d.shortLabel);

                  return (
                    <button
                      key={member.id}
                      type="button"
                      onClick={() => handleSelectMember(member)}
                      className={`w-full p-3.5 rounded-xl border text-left transition flex items-start justify-between gap-3 ${
                        isCurrent
                          ? 'bg-blue-600/15 border-blue-500/60'
                          : 'bg-slate-950 border-slate-800 hover:border-slate-700 hover:bg-slate-900'
                      }`}
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-sm text-white">{member.name}</span>
                          <span className="text-slate-600" aria-hidden="true">
                            ·
                          </span>
                          <span
                            className={`text-xs font-semibold ${
                              member.role === 'Store Owner / Admin'
                                ? 'text-amber-300'
                                : 'text-blue-300'
                            }`}
                          >
                            {member.role}
                          </span>
                          {member.pin && (
                            <span
                              className="inline-flex items-center gap-1 text-[10px] text-slate-400 font-medium"
                              title="PIN protected operator"
                            >
                              <Lock className="w-3 h-3" />
                              PIN
                            </span>
                          )}
                        </div>

                        <div className="text-[11px] text-slate-400 tabular-nums">
                          Access: {grantedCount}/{totalCount} permissions ·{' '}
                          {grantedLabels.join(', ')}
                          {grantedCount > 4 ? ` +${grantedCount - 4} more` : ''}
                        </div>
                      </div>

                      <div className="flex-shrink-0 pt-0.5">
                        {isCurrent ? (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-blue-600 text-white text-[11px] font-bold whitespace-nowrap">
                            <Check className="w-3 h-3" />
                            Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300 border border-slate-700 text-[11px] font-semibold whitespace-nowrap">
                            Switch
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>

              {inactiveMembers.length > 0 && (
                <div className="pt-2 border-t border-slate-800/80 text-[11px] text-slate-500">
                  {inactiveMembers.length} inactive staff account
                  {inactiveMembers.length === 1 ? '' : 's'} hidden from login switcher.
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-slate-950 border-t border-slate-800 flex items-center justify-between gap-2 text-xs">
          {onOpenTeamTab ? (
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenTeamTab();
              }}
              className="text-blue-300 hover:text-blue-200 font-semibold flex items-center gap-1.5"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Manage Staff &amp; Role Permissions</span>
            </button>
          ) : (
            <span className="text-slate-500">Role-Based Access Control enabled</span>
          )}
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

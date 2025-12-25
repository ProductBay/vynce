// src/components/DialPad.jsx
import React, { useEffect } from 'react';
import './DialPad.css';

export default function DialPad({
  value,
  onDigit,
  onBackspace,
  onClear,
  onCall,
  disabled,
}) {
  const digits = [
    ['1', ''],
    ['2', 'ABC'],
    ['3', 'DEF'],
    ['4', 'GHI'],
    ['5', 'JKL'],
    ['6', 'MNO'],
    ['7', 'PQRS'],
    ['8', 'TUV'],
    ['9', 'WXYZ'],
    ['*', ''],
    ['0', '+'],
    ['#', ''],
  ];

  const handleDigitClick = (d) => {
    if (!disabled && onDigit) onDigit(d);
  };

  const handleClear = () => {
    if (!disabled && onClear) onClear();
  };

  const handleBackspace = () => {
    if (!disabled && onBackspace) onBackspace();
  };

  const handleCall = () => {
    if (!disabled && onCall) onCall();
  };

  // === Keyboard support ===
  useEffect(() => {
    if (disabled) return;

    const handleKeyDown = (e) => {
      // Don’t steal keys from text inputs / textareas / contenteditable
      const tag = e.target.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) {
        return;
      }

      const key = e.key;

      // Digits, star, hash, plus
      const digitKeys = ['0','1','2','3','4','5','6','7','8','9','*','#','+'];
      if (digitKeys.includes(key)) {
        e.preventDefault();
        if (onDigit) onDigit(key);
        return;
      }

      // Backspace -> delete last
      if (key === 'Backspace') {
        e.preventDefault();
        if (onBackspace) onBackspace();
        return;
      }

      // Delete -> clear all
      if (key === 'Delete') {
        e.preventDefault();
        if (onClear) onClear();
        return;
      }

      // Enter -> Call (if we have a number)
      if (key === 'Enter') {
        if (!value) return;
        e.preventDefault();
        if (onCall) onCall();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [disabled, onDigit, onBackspace, onClear, onCall, value]);

  return (
    <div className="dialpad-root">
      <div className="dialpad-display">
        <span className="dialpad-display-value">
          {value || 'Tap digits or use your keyboard to enter a number'}
        </span>
      </div>

      <div className="dialpad-grid">
        {digits.map(([d, letters]) => (
          <button
            key={d}
            type="button"
            className="dialpad-key"
            disabled={disabled}
            onClick={() => handleDigitClick(d)}
          >
            <span className="dialpad-key-main">{d}</span>
            {letters && <span className="dialpad-key-sub">{letters}</span>}
          </button>
        ))}
      </div>

      <div className="dialpad-actions">
        <button
          type="button"
          className="dialpad-action dialpad-clear"
          onClick={handleClear}
          disabled={disabled || !value}
        >
          Clear
        </button>
        <button
          type="button"
          className="dialpad-action dialpad-backspace"
          onClick={handleBackspace}
          disabled={disabled || !value}
        >
          ⌫
        </button>
        <button
          type="button"
          className="dialpad-action dialpad-call"
          onClick={handleCall}
          disabled={disabled || !value}
        >
          📞 Call
        </button>
      </div>
    </div>
  );
}
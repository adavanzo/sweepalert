import React from 'react';

import { Button } from '../../components/Button';
import { T } from '../../components/primitives';
import { useTheme } from '../../theme/ThemeContext';

type Props = {
  unsupported: boolean;
  saved: boolean;
  /** Enabled reminders on the assigned car, for the confirmation line. */
  activeReminders: number;
  onSave: () => void;
};

/** The save button and the post-save confirmation line. */
export function SaveSpotAction({ unsupported, saved, activeReminders, onSave }: Props) {
  const { c } = useTheme();
  return (
    <>
      <Button title={unsupported ? 'Save location anyway' : 'Save parking spot'} onPress={onSave} />
      {saved && (
        <T style={{ textAlign: 'center', fontSize: 12.5, fontWeight: '500', color: unsupported ? c.warn : c.ok }}>
          {unsupported
            ? 'Location saved. No cleaning schedule for this area — no reminders set.'
            : `Saved. ${activeReminders} reminders set for this block.`}
        </T>
      )}
    </>
  );
}

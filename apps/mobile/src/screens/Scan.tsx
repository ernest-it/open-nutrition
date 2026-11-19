import { useRef, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { OFF_ATTRIBUTION } from '@open-nutrition/shared';
import { lookupBarcode, offContributeUrl } from '../foods';
import { useLayout } from '../layout';
import { useAddNav } from '../nav';
import { useAccount, useStore } from '../state';
import { Button, Card, Input, MEAL_LABELS, Notice, SheetHeader, T, formatDay, haptic, styles } from '../ui';

type Status = { kind: 'idle' } | { kind: 'busy'; code: string } | { kind: 'not_found'; code: string } | { kind: 'error'; message: string };

export function ScanScreen({ onBack }: { onBack?: () => void }) {
  const nav = useAddNav();
  const store = useStore();
  const account = useAccount();
  const { landscape, wide } = useLayout();
  const [permission, requestPermission] = useCameraPermissions();
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [manual, setManual] = useState('');
  const lastCode = useRef<{ code: string; at: number } | null>(null);
  const busy = status.kind === 'busy';

  async function lookup(raw: string) {
    const code = raw.replace(/\D/g, '');
    if (!code) return;
    setStatus({ kind: 'busy', code });
    try {
      const r = await lookupBarcode(store, account, code);
      if (r.kind === 'found') {
        haptic.success();
        nav.replace({ name: 'food', food: r.food });
      } else if (r.kind === 'invalid') {
        haptic.warn();
        setStatus({ kind: 'error', message: `“${code}” is not a valid product barcode (EAN-13, EAN-8, UPC-A or UPC-E). Try again.` });
      } else {
        haptic.warn();
        setStatus({ kind: 'not_found', code });
      }
    } catch (e) {
      setStatus({ kind: 'error', message: `${(e as Error).message} You can still create the food yourself.` });
    }
  }

  function onScanned(r: BarcodeScanningResult) {
    if (busy || status.kind === 'not_found') return;
    const now = Date.now();
    // The scanner fires many times per second; ignore repeats of the same code for a moment.
    if (lastCode.current && lastCode.current.code === r.data && now - lastCode.current.at < 2500) return;
    lastCode.current = { code: r.data, at: now };
    void lookup(r.data);
  }

  const camera = (
    <View style={[s.cameraBox, { backgroundColor: '#000' }, landscape ? { flex: 1 } : { aspectRatio: wide ? 16 / 9 : 4 / 3 }]}>
      {permission?.granted ? (
        <>
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e'] }}
            onBarcodeScanned={busy || status.kind === 'not_found' ? undefined : onScanned}
          />
          <View pointerEvents="none" style={s.frameWrap}>
            <View style={[s.frame, { borderColor: 'rgba(255,255,255,0.9)' }]} />
          </View>
          {busy && (
            <View style={s.busy}>
              <ActivityIndicator color="#fff" size="large" />
              <T color="#fff">Looking up {status.code}…</T>
            </View>
          )}
        </>
      ) : (
        <View style={s.permission}>
          <T color="#fff" style={{ textAlign: 'center' }}>
            {permission == null ? 'Checking camera access…' : 'Allow camera access to scan barcodes. You can also type the number below.'}
          </T>
          {permission && !permission.granted && (
            <Button
              title={permission.canAskAgain ? 'Allow camera' : 'Open settings'}
              variant="primary"
              onPress={() => (permission.canAskAgain ? void requestPermission() : void Linking.openSettings())}
            />
          )}
        </View>
      )}
    </View>
  );

  const controls = (
    <View>
      {status.kind === 'not_found' && (
        <Card>
          <T bold>No product found for {status.code}</T>
          <T small muted style={{ marginTop: 4 }}>
            Create it from the label and it will be found next time you scan it.
          </T>
          <Button title="Create this food" variant="primary" icon="plus" onPress={() => nav.push({ name: 'newFood', barcode: status.code })} />
          <Notice>
            <T small>Open Food Facts is a free, open database built by volunteers. You can add this product there too, so others can scan it.</T>
            <Button small variant="ghost" title="Add it to Open Food Facts" onPress={() => void Linking.openURL(offContributeUrl(status.code))} style={{ alignSelf: 'flex-start' }} />
          </Notice>
          <Button title="Scan another" variant="ghost" onPress={() => setStatus({ kind: 'idle' })} />
        </Card>
      )}
      {status.kind === 'error' && (
        <Card>
          <T>{status.message}</T>
          <Button title="Try again" onPress={() => setStatus({ kind: 'idle' })} />
        </Card>
      )}
      <T small muted style={{ marginTop: 8 }}>
        Or type the barcode number
      </T>
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Input value={manual} onChangeText={setManual} keyboardType="number-pad" placeholder="e.g. 5000159484695" accessibilityLabel="Barcode number" onSubmitEditing={() => void lookup(manual)} />
        </View>
        <Button title="Look up" onPress={() => void lookup(manual)} disabled={busy || manual.replace(/\D/g, '').length < 8} />
      </View>
      <T small muted style={{ marginTop: 10 }}>
        {OFF_ATTRIBUTION}
      </T>
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      <SheetHeader title={`Scan · ${MEAL_LABELS[nav.meal]} · ${formatDay(nav.day)}`} onBack={onBack} onClose={() => nav.close()} />
      {landscape ? (
        <View style={{ flex: 1, flexDirection: 'row', gap: 12, padding: 12 }}>
          {camera}
          <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
            {controls}
          </ScrollView>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 32 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
          {camera}
          {controls}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  cameraBox: { width: '100%', borderRadius: 16, overflow: 'hidden' },
  frameWrap: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  frame: { width: '72%', aspectRatio: 2.2, borderWidth: 2, borderRadius: 12 },
  busy: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', gap: 8 },
  permission: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16, gap: 10, minHeight: 200 },
});

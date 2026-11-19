import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

/** Small stroke icon set drawn on a 24×24 grid (original artwork for this app). */
export type IconName =
  | 'today'
  | 'diary'
  | 'plus'
  | 'minus'
  | 'nutrients'
  | 'more'
  | 'scale'
  | 'food'
  | 'settings'
  | 'search'
  | 'barcode'
  | 'camera'
  | 'image'
  | 'sparkle'
  | 'bolt'
  | 'bookmark'
  | 'star'
  | 'starFilled'
  | 'trash'
  | 'close'
  | 'check'
  | 'chevronLeft'
  | 'chevronRight'
  | 'chevronDown'
  | 'drop'
  | 'copy'
  | 'calendar'
  | 'edit'
  | 'move'
  | 'info';

export function Icon({ name, size = 24, color, strokeWidth = 2 }: { name: IconName; size?: number; color: string; strokeWidth?: number }) {
  const p = { stroke: color, strokeWidth, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
      {shape(name, p, color)}
    </Svg>
  );
}

type P = { stroke: string; strokeWidth: number; fill: string; strokeLinecap: 'round'; strokeLinejoin: 'round' };

function shape(name: IconName, p: P, color: string) {
  switch (name) {
    case 'today': // sun-ish: a ring with a dot
      return (
        <>
          <Circle cx={12} cy={12} r={8} {...p} />
          <Path d="M12 7v5l3 2" {...p} />
        </>
      );
    case 'diary':
      return (
        <>
          <Rect x={5} y={3} width={14} height={18} rx={2} {...p} />
          <Line x1={9} y1={8} x2={15} y2={8} {...p} />
          <Line x1={9} y1={12} x2={15} y2={12} {...p} />
          <Line x1={9} y1={16} x2={13} y2={16} {...p} />
        </>
      );
    case 'plus':
      return <Path d="M12 5v14M5 12h14" {...p} />;
    case 'minus':
      return <Path d="M5 12h14" {...p} />;
    case 'nutrients':
      return (
        <>
          <Line x1={6} y1={20} x2={6} y2={12} {...p} />
          <Line x1={12} y1={20} x2={12} y2={5} {...p} />
          <Line x1={18} y1={20} x2={18} y2={9} {...p} />
        </>
      );
    case 'more':
      return (
        <>
          <Circle cx={5} cy={12} r={1.5} fill={color} stroke="none" />
          <Circle cx={12} cy={12} r={1.5} fill={color} stroke="none" />
          <Circle cx={19} cy={12} r={1.5} fill={color} stroke="none" />
        </>
      );
    case 'scale':
      return (
        <>
          <Rect x={3} y={4} width={18} height={16} rx={4} {...p} />
          <Path d="M8 10a4 4 0 0 1 8 0" {...p} />
          <Line x1={12} y1={10} x2={13.5} y2={7.5} {...p} />
        </>
      );
    case 'food': // an apple
      return (
        <>
          <Path d="M12 7c-2-1.5-6-1-6.5 3.5C5 15 8 20 10 20c1 0 1.2-.5 2-.5s1 .5 2 .5c2 0 5-5 4.5-9.5C18 6 14 5.5 12 7z" {...p} />
          <Path d="M12 7c0-2 1-3.5 3-4" {...p} />
        </>
      );
    case 'settings':
      return (
        <>
          <Circle cx={12} cy={12} r={3} {...p} />
          <Path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" {...p} />
        </>
      );
    case 'search':
      return (
        <>
          <Circle cx={11} cy={11} r={6.5} {...p} />
          <Line x1={16} y1={16} x2={20.5} y2={20.5} {...p} />
        </>
      );
    case 'barcode':
      return <Path d="M4 6v12M7 6v12M10.5 6v12M13 6v12M16.5 6v12M20 6v12" {...p} />;
    case 'camera':
      return (
        <>
          <Path d="M4 8h3l2-3h6l2 3h3v11H4z" {...p} />
          <Circle cx={12} cy={13} r={3.5} {...p} />
        </>
      );
    case 'image':
      return (
        <>
          <Rect x={3} y={4} width={18} height={16} rx={2} {...p} />
          <Circle cx={9} cy={9.5} r={1.5} {...p} />
          <Path d="M21 16l-5-5-8 8" {...p} />
        </>
      );
    case 'sparkle':
      return (
        <>
          <Path d="M10 3l1.8 5.2L17 10l-5.2 1.8L10 17l-1.8-5.2L3 10l5.2-1.8z" {...p} />
          <Path d="M18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8z" {...p} />
        </>
      );
    case 'bolt':
      return <Path d="M13 3L5 13h6l-1 8 8-10h-6z" {...p} />;
    case 'bookmark':
      return <Path d="M6 3h12v18l-6-4-6 4z" {...p} />;
    case 'star':
      return <Path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z" {...p} />;
    case 'starFilled':
      return <Path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z" {...p} fill={color} />;
    case 'trash':
      return (
        <>
          <Path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" {...p} />
        </>
      );
    case 'close':
      return <Path d="M6 6l12 12M18 6L6 18" {...p} />;
    case 'check':
      return <Path d="M5 12.5l4.5 4.5L19 7.5" {...p} />;
    case 'chevronLeft':
      return <Path d="M15 5l-7 7 7 7" {...p} />;
    case 'chevronRight':
      return <Path d="M9 5l7 7-7 7" {...p} />;
    case 'chevronDown':
      return <Path d="M5 9l7 7 7-7" {...p} />;
    case 'drop':
      return <Path d="M12 3c3.5 4.5 6 7.8 6 11a6 6 0 0 1-12 0c0-3.2 2.5-6.5 6-11z" {...p} />;
    case 'copy':
      return (
        <>
          <Rect x={8} y={8} width={12} height={12} rx={2} {...p} />
          <Path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" {...p} />
        </>
      );
    case 'calendar':
      return (
        <>
          <Rect x={3.5} y={5} width={17} height={15} rx={2} {...p} />
          <Path d="M3.5 10h17M8 3v4M16 3v4" {...p} />
        </>
      );
    case 'edit':
      return <Path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" {...p} />;
    case 'move':
      return <Path d="M5 12h14M15 8l4 4-4 4M9 8l-4 4 4 4" {...p} />;
    case 'info':
      return (
        <>
          <Circle cx={12} cy={12} r={9} {...p} />
          <Path d="M12 11v6M12 7.5v.5" {...p} />
        </>
      );
  }
}

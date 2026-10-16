// The clip timeline under the canvas: a ruler with the keys on it, a
// playhead to scrub, play and loop, and the selected key's state, ease and
// time. Picking a key puts the playhead on it, and the canvas then poses
// that key (state/editor.ts editPose).

import { useEffect, useRef, useState } from "preact/hooks";
import { clipDuration, type Curve, type Ease } from "@fastart/core";
import { menuAt } from "../state/menu.ts";
import { Button, NumberField, Select, TextField, cx } from "./ur.tsx";
import { ed, curClip, states, addKey, deleteKey, setKeyTime, setKeyState, setKeyEase, setKeyCurve, setKeyEvents, keyToState, freshName, seek, endGesture } from "../state/editor.ts";

const EASES: Ease[] = ["linear", "in", "out", "in-out", "step"];
/** Curves worth a name (1.2); "custom" keeps whatever the numbers say. */
const CURVES: { name: string; curve: Curve; ease: Ease }[] = [
	{ name: "back out", curve: [0.34, 1.56, 0.64, 1], ease: "out" },
	{ name: "back in", curve: [0.36, 0, 0.66, -0.56], ease: "in" },
	{ name: "quint out", curve: [0.22, 1, 0.36, 1], ease: "out" },
	{ name: "quint in", curve: [0.64, 0, 0.78, 0], ease: "in" },
	{ name: "sine in-out", curve: [0.37, 0, 0.63, 1], ease: "in-out" },
];
const curveName = (c: Curve | undefined) => (c ? (CURVES.find((k) => k.curve.every((v, i) => Math.abs(v - c[i]) < 1e-6))?.name ?? "custom") : "");
const PAD = 14;

/** The key's events as one typed line: it lands when the field is left or Return is pressed. */
function EventsField({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
	const [v, set] = useState(value);
	useEffect(() => set(value), [value]);
	const commit = (t: string) => {
		if (t !== value) onCommit(t);
	};
	return (
		<span class="ed-tl-events" title="Names a game hears when the playhead crosses this key: footstep, hit, …  (comma-separated)">
			<TextField value={v} placeholder="Events" onChange={set} onBlur={commit} onSubmit={commit} />
		</span>
	);
}

export function Timeline() {
	void ed.rev.value;
	const clip = curClip();
	const track = useRef<HTMLDivElement>(null);
	const playing = ed.playing.value;

	// playback: advance the clock each frame
	useEffect(() => {
		if (!playing || !clip) return;
		let raf = 0;
		let last = performance.now();
		const tick = (now: number) => {
			const dt = (now - last) / 1000;
			last = now;
			const dur = clipDuration(clip);
			let t = ed.clipTime.value + dt;
			if (dur <= 0) t = 0;
			else if (t >= dur) {
				if (clip.loop) t = t % dur;
				else {
					t = dur;
					ed.playing.value = false;
				}
			}
			ed.clipTime.value = t;
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	}, [playing, clip]);

	if (!clip) return null;
	const dur = clipDuration(clip);
	const span = Math.max(dur, 1);
	const t = ed.clipTime.value;
	const ki = ed.curKey.value;
	const key = clip.keys[ki];

	const toT = (clientX: number) => {
		const r = track.current!.getBoundingClientRect();
		const u = (clientX - r.left - PAD) / Math.max(r.width - 2 * PAD, 1);
		return Math.max(0, Math.min(span, u * span));
	};
	const pct = (time: number) => `${PAD + (time / span) * 100}%`;
	const left = (time: number) => `calc(${PAD}px + (100% - ${2 * PAD}px) * ${time / span})`;

	const scrub = (e: PointerEvent) => {
		const el = e.currentTarget as HTMLElement;
		try {
			el.setPointerCapture(e.pointerId);
		} catch {
			// no live pointer to capture: the click still counts
		}
		ed.playing.value = false;
		seek(toT(e.clientX));
		const move = (ev: PointerEvent) => seek(toT(ev.clientX));
		const up = () => {
			el.removeEventListener("pointermove", move);
			el.removeEventListener("pointerup", up);
		};
		el.addEventListener("pointermove", move);
		el.addEventListener("pointerup", up);
	};
	const dragKey = (i: number, e: PointerEvent) => {
		e.stopPropagation();
		const el = e.currentTarget as HTMLElement;
		try {
			el.setPointerCapture(e.pointerId);
		} catch {
			// as above
		}
		ed.playing.value = false;
		ed.curKey.value = i;
		ed.clipTime.value = clip.keys[i].t; // picking a key is also going there
		let idx = i;
		const move = (ev: PointerEvent) => {
			const nt = Math.round(toT(ev.clientX) * 100) / 100;
			setKeyTime(idx, nt, "key-time");
			idx = ed.curKey.value;
			ed.clipTime.value = nt;
		};
		const up = () => {
			endGesture();
			el.removeEventListener("pointermove", move);
			el.removeEventListener("pointerup", up);
		};
		el.addEventListener("pointermove", move);
		el.addEventListener("pointerup", up);
	};

	void pct;
	const canDelete = clip.keys.length >= 2;
	return (
		<div class="ed-timeline">
			<Button variant="toolbar" icon={playing ? "pause" : "play"} title="Play / pause (Space)" onClick={() => (ed.playing.value = !playing)} />
			<span class="ed-tl-time">
				{t.toFixed(2)} / {dur.toFixed(2)} s
			</span>
			<div class="ed-tl-track" ref={track} onPointerDown={scrub}>
				{Array.from({ length: Math.floor(span) + 1 }, (_, s) => (
					<span class="ed-tl-tick" style={{ left: left(s) }}>
						{s}s
					</span>
				))}
				{clip.keys.map((k, i) => (
					<span
						class={cx("ed-tl-key", i === ki && "selected", !!k.events?.length && "ev")}
						style={{ left: left(k.t) }}
						title={`${k.state ?? "own pose"} @ ${k.t}s${k.events?.length ? ` · ${k.events.join(", ")}` : ""}`}
						tabIndex={0}
						onPointerDown={(e) => dragKey(i, e)}
						onContextMenu={(e) => {
							ed.curKey.value = i;
							ed.clipTime.value = k.t;
							menuAt(e, [
								{ label: "Save pose as a state", disabled: k.state !== undefined, run: () => keyToState(i, freshName(`${clip.name} ${k.t}s`, states().map((s) => s.name))) },
								{ label: "Delete key", danger: true, sep: true, disabled: !canDelete, run: () => deleteKey(i) },
							]);
						}}
						onKeyDown={(e) => {
							if ((e.key === "Backspace" || e.key === "Delete") && canDelete) {
								e.preventDefault();
								e.stopPropagation();
								deleteKey(i);
							}
						}}
					/>
				))}
				<span class="ed-tl-playhead" style={{ left: left(t) }} />
			</div>
			<Button icon="plus" title="A key at the playhead" onClick={addKey}>
				Key
			</Button>
			{key && (
				<>
					<Select value={key.state ?? ""} width={120} title="The state this key shows" options={[...(key.state === undefined ? [{ value: "", label: "Own pose" }] : []), ...states().map((s) => ({ value: s.name, label: s.name }))]} onChange={(v) => setKeyState(ki, v)} />
					<Select<Ease> value={key.ease ?? "linear"} width={84} title="How time approaches this key" disabled={!!key.curve} options={EASES} onChange={(v) => setKeyEase(ki, v)} />
					<Select
						value={curveName(key.curve)}
						width={104}
						title="A bezier curve toward this key; it wins over the ease, which stays as the nearest name for older readers"
						options={[{ value: "", label: "No curve" }, ...CURVES.map((c) => ({ value: c.name, label: c.name })), { value: "custom", label: "Custom…" }]}
						onChange={(v) => {
							if (!v) return setKeyCurve(ki, undefined);
							const preset = CURVES.find((c) => c.name === v);
							if (preset) {
								setKeyCurve(ki, preset.curve);
								setKeyEase(ki, preset.ease);
							} else setKeyCurve(ki, key.curve ?? [0.42, 0, 0.58, 1]);
						}}
					/>
					{key.curve &&
						key.curve.map((v, j) => (
							<NumberField
								key={j}
								value={v}
								step={0.01}
								stepper={false}
								width={48}
								label={["x1", "y1", "x2", "y2"][j]}
								title={["x1", "y1", "x2", "y2"][j]}
								onChange={(n) => {
									const c = [...key.curve!] as Curve;
									c[j] = n;
									setKeyCurve(ki, c, `curve-${ki}`);
								}}
								onDone={endGesture}
							/>
						))}
					<EventsField key={`${ed.curClip.value}:${ki}`} value={key.events?.join(", ") ?? ""} onCommit={(v) => setKeyEvents(ki, v.split(","))} />
					<NumberField value={key.t} min={0} step={0.05} suffix="s" stepper={false} width={64} label="Seconds" title="Seconds" onChange={(v) => setKeyTime(ki, v)} />
					<Button variant="toolbar" class="ur-btn-sm" icon="trash-2" title="Delete key (⌫)" disabled={!canDelete} onClick={() => deleteKey(ki)} />
				</>
			)}
		</div>
	);
}

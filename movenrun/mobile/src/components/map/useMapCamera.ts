/**
 * The map camera: who is allowed to move it, and when.
 *
 * ## The rule that matters
 *
 * **A player who moves the map keeps it.** The camera follows the player until
 * the player touches it, and then it stops following until they ask for it
 * back. A camera that re-centres itself a second after a pan is not a helpful
 * camera; it is a fight, and the player loses it every time — they cannot look
 * at the next street corner, or at the loop they are trying to close, without
 * the map yanking itself back.
 *
 * So panning drops follow mode, and only {@link MapCamera.recenter} restores
 * it. The recentre control is always on screen while following is off, so the
 * way back is one tap and never hidden.
 *
 * ## Why this is a hook and not a component
 *
 * The camera is imperative — `animateToRegion` on a ref — while everything
 * around it is declarative. Wrapping it in a component would mean re-rendering
 * a subtree to cause a side effect, which is how a camera ends up being
 * commanded on every parent render. Here the follow effect depends on the head
 * fix and nothing else, so a clock tick, a re-render, or a metric changing
 * moves no camera.
 *
 * ## Reduced motion
 *
 * Every camera move here is a real position change, not decoration, so it is
 * never skipped. Under Reduce Motion it happens *instantly* instead of gliding:
 * the player still ends up looking at the right place, without the pan. That is
 * the distinction the setting asks for — remove the animation, keep the result.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  MIN_SPAN_DEGREES,
  regionAround,
  regionsClose,
  type LatLng,
  type MapRegion,
} from "@/lib/mapGeometry";

/** How much ground the follow camera keeps around the player, in metres. */
export const FOLLOW_RADIUS_M = 140;

/** Camera glide, in ms. Zero under Reduce Motion. */
export const CAMERA_DURATION_MS = 450;

/** Inset used when fitting a whole route, so the line never touches the frame. */
export const FIT_EDGE_PADDING = { top: 56, right: 56, bottom: 56, left: 56 };

/**
 * The slice of the provider's map handle this module needs.
 *
 * Declared structurally rather than as the provider's own ref type: the camera
 * rules are then testable against a plain object, and this file does not become
 * a second place that knows which map library the app uses.
 */
export interface CameraTarget {
  animateToRegion(region: MapRegion, duration?: number): void;
  fitToCoordinates(
    coordinates?: LatLng[],
    options?: { edgePadding?: { top: number; right: number; bottom: number; left: number }; animated?: boolean },
  ): void;
}

export type CameraMode = "following" | "free";

export interface MapCamera {
  /** Whether the camera is currently tracking the player. */
  mode: CameraMode;
  /** Follow the player again, and move to them now. */
  recenter(): void;
  /** Frame the whole route. Leaves follow mode, because the player asked to
   *  look at something other than where they are. */
  fitRoute(coordinates: readonly LatLng[]): void;
  /** The player dragged the map. Called from the map's pan handler. */
  onUserPan(): void;
  /** Hand the camera its target once the native view exists. */
  attach(target: CameraTarget | null): void;
  /** Native initialization completed; replay the latest requested camera command. */
  onReady(): void;
}

export interface MapCameraOptions {
  /** The player's latest fix, or null while there is none. */
  head: LatLng | null;
  /** Move instantly rather than gliding. */
  reducedMotion?: boolean;
  /** Ground kept around the player while following. */
  followRadiusMeters?: number;
  /** Start free rather than following — used by static, already-framed maps. */
  initialMode?: CameraMode;
  followEnabled?: boolean;
}

export function useMapCamera(options: MapCameraOptions): MapCamera {
  const { head, reducedMotion = false, followRadiusMeters = FOLLOW_RADIUS_M } = options;
  const [mode, setMode] = useState<CameraMode>(options.initialMode ?? "following");

  const targetRef = useRef<CameraTarget | null>(null);
  const readyRef = useRef(false);
  type Command = { region: MapRegion; duration: number } | { coordinates: LatLng[]; animated: boolean };
  const pendingRef = useRef<Command | null>(null);
  /** The last region we asked for, so an unchanged head issues no command. */
  const lastRegionRef = useRef<MapRegion | null>(null);
  /** Read inside the follow effect without making it depend on the mode. */
  const modeRef = useRef<CameraMode>(mode);
  modeRef.current = mode;

  const duration = reducedMotion ? 0 : CAMERA_DURATION_MS;

  const execute = useCallback((command: Command) => {
    const target = targetRef.current;
    if (target === null || !readyRef.current) { pendingRef.current = command; return; }
    pendingRef.current = null;
    if ("region" in command) {
      if (regionsClose(lastRegionRef.current, command.region, MIN_SPAN_DEGREES / 10)) return;
      target.animateToRegion(command.region, command.duration);
      lastRegionRef.current = command.region;
    } else {
      lastRegionRef.current = null;
      target.fitToCoordinates(command.coordinates, { edgePadding: FIT_EDGE_PADDING, animated: command.animated });
    }
  }, []);

  const moveTo = useCallback(
    (region: MapRegion) => {
      /* A fix a few centimetres from the last one is not a camera move. The
         watch delivers every few metres, and animating each one would keep the
         map permanently in motion under the player's finger. */
      execute({ region, duration });
    },
    [duration, execute],
  );

  const attach = useCallback((target: CameraTarget | null) => {
    if (targetRef.current === target) return;
    targetRef.current = target;
    readyRef.current = false;
    lastRegionRef.current = null;
  }, []);
  const onReady = useCallback(() => {
    readyRef.current = true;
    if (pendingRef.current) execute(pendingRef.current);
  }, [execute]);

  const followEnabled = options.followEnabled ?? options.initialMode !== "free";
  const previouslyEnabled = useRef(followEnabled);
  useEffect(() => {
    if (followEnabled && !previouslyEnabled.current) {
      modeRef.current = "following";
      setMode("following");
      lastRegionRef.current = null;
    }
    previouslyEnabled.current = followEnabled;
  }, [followEnabled]);

  /* Follow. Depends on the head fix, so it runs when the player moves and at
     no other time — not on the session clock, not on a metric changing, not on
     a parent re-render. */
  useEffect(() => {
    if (head === null) { pendingRef.current = null; lastRegionRef.current = null; return; }
    if (modeRef.current !== "following") return;
    moveTo(regionAround(head, followRadiusMeters));
  }, [head, followRadiusMeters, moveTo, followEnabled]);

  const recenter = useCallback(() => {
    setMode("following");
    modeRef.current = "following";
    /* Clear the memo so the move happens even if the camera was already asked
       for this exact region before the player panned away from it. */
    lastRegionRef.current = null;
    if (head !== null) moveTo(regionAround(head, followRadiusMeters));
  }, [head, followRadiusMeters, moveTo]);

  const fitRoute = useCallback(
    (coordinates: readonly LatLng[]) => {
      if (coordinates.length === 0) return;
      setMode("free");
      modeRef.current = "free";
      lastRegionRef.current = null;
      execute({ coordinates: [...coordinates], animated: !reducedMotion });
    },
    [reducedMotion, execute],
  );

  const onUserPan = useCallback(() => {
    pendingRef.current = null;
    /* Only a transition is worth a state update — the pan handler fires
       continuously through a drag, and setting "free" on every frame would
       re-render the screen for the length of the gesture. */
    if (modeRef.current === "free") return;
    modeRef.current = "free";
    setMode("free");
  }, []);

  /* Memoised as a whole. Callers hold this object in `useCallback` deps and in
     `useImperativeHandle` — a fresh literal per render would make every one of
     those unstable, which is how the map's ref callback ends up detaching and
     re-attaching the camera on each re-render. */
  return useMemo(
    () => ({ mode, recenter, fitRoute, onUserPan, attach, onReady }),
    [mode, recenter, fitRoute, onUserPan, attach, onReady],
  );
}

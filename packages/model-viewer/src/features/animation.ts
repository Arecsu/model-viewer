/* @license
 * Copyright 2019 Google LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an 'AS IS' BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {property} from 'lit/decorators.js';
import {LoopOnce, LoopPingPong, LoopRepeat, Quaternion, Object3D} from 'three';

import ModelViewerElementBase, {$getModelIsVisible, $needsRender, $onModelLoad, $renderer, $scene, $tick} from '../model-viewer-base.js';
import {Constructor} from '../utilities.js';

const MILLISECONDS_PER_SECOND = 1000.0

const $changeAnimation = Symbol('changeAnimation');
const $paused = Symbol('paused');

interface PlayAnimationOptions {
  repetitions: number, pingpong: boolean,
}

interface ExtendedObject3DType extends Object3D {
  quaternionAtKeyframe1: Quaternion,
  initialQuaternion: Quaternion,
}

const DEFAULT_PLAY_OPTIONS: PlayAnimationOptions = {
  repetitions: Infinity,
  pingpong: false
};

export declare interface AnimationInterface {
  autoplay: boolean;
  animationName: string|void;
  animationCrossfadeDuration: number;
  readonly availableAnimations: Array<string>;
  readonly paused: boolean;
  readonly duration: number;
  currentTime: number;
  timeScale: number;
  pause(): void;
  play(options?: PlayAnimationOptions): void;
}

export const AnimationMixin = <T extends Constructor<ModelViewerElementBase>>(
    ModelViewerElement: T): Constructor<AnimationInterface>&T => {
  class AnimationModelViewerElement extends ModelViewerElement {
    @property({type: Boolean}) autoplay: boolean = false;
    @property({type: String, attribute: 'animation-name'})
    animationName: string|undefined = undefined;
    @property({type: Number, attribute: 'animation-crossfade-duration'})
    animationCrossfadeDuration: number = 300;

    protected[$paused]: boolean = true;

    constructor(...args: any[]) {
      super(args);

      this[$scene].subscribeMixerEvent('loop', (e) => {
        const count = e.action._loopCount;
        this.dispatchEvent(new CustomEvent('loop', {detail: {count}}));
      });
      this[$scene].subscribeMixerEvent('finished', () => {
        this[$paused] = true;
        this.dispatchEvent(new CustomEvent('finished'));
      });
    }

    /**
     * Returns an array
     */
    get availableAnimations(): Array<string> {
      if (this.loaded) {
        return this[$scene].animationNames;
      }

      return [];
    }

    get duration(): number {
      return this[$scene].duration;
    }

    get paused(): boolean {
      return this[$paused];
    }

    get currentTime(): number {
      return this[$scene].animationTime;
    }

    set currentTime(value: number) {
      this[$scene].animationTime = value;
      this[$needsRender]();
    }

    get timeScale(): number {
      return this[$scene].animationTimeScale;
    }

    set timeScale(value: number) {
      this[$scene].animationTimeScale = value;
    }

    // monk mönk
		resetRotationSmooth() {
			const currentAnimation = this[$scene].animations[0];
			if (!currentAnimation) return

			for (const object of this[$scene].model!.children as ExtendedObject3DType[]) {
				const rotationTrack = currentAnimation.tracks.find(track => track.name === `${object.name}.quaternion`)!;

				// Assuming rotationTrack.values contains [x1, y1, z1, w1, x2, y2, z2, w2, ...]
				// at frame 0, the quaternion is x1, y1, z1, w1
				const quaternionAtKeyframe1 = new Quaternion(
					rotationTrack.values[0], // x
					rotationTrack.values[1], // y
					rotationTrack.values[2], // z
					rotationTrack.values[3]  // w
				);

				// get the current quaternion of the object
				const initialQuaternion = object.quaternion.clone();

				// save initial quaternion values to the object
				// they will be used to compute the rotation in the upcoming animate() private function below
				object.quaternionAtKeyframe1 = quaternionAtKeyframe1;
				object.initialQuaternion = initialQuaternion;
			}

			let t = 0;
			const rotationDuration = 750; // Duration of the animation in milliseconds
			const startTime = performance.now();

			const animate = () => {
				const elapsedTime = performance.now() - startTime;
				t = elapsedTime / rotationDuration;

				// easeOutQuart
				const easedT = 1 - Math.pow(1 - t, 4);

				if (t < 1) {
					for (const object of this[$scene].model!.children as ExtendedObject3DType[]) {
						const toQuaternion = new Quaternion().slerpQuaternions(object.initialQuaternion, object.quaternionAtKeyframe1, easedT);
						object.quaternion.copy(toQuaternion);
					}
					this[$needsRender]();
					requestAnimationFrame(animate);
				}
			}
			animate();
		}

    pause() {
      if (this[$paused]) {
        return;
      }

      this[$paused] = true;
      this.dispatchEvent(new CustomEvent('pause'));
    }

    play(options?: PlayAnimationOptions) {
      if (this.availableAnimations.length > 0) {
        this[$paused] = false;

        this[$changeAnimation](options);

        this.dispatchEvent(new CustomEvent('play'));
      }
    }

    [$onModelLoad]() {
      super[$onModelLoad]();

      this[$paused] = true;

      if (this.animationName != null) {
        this[$changeAnimation]();
      }

      if (this.autoplay) {
        this.play();
      }
    }

    [$tick](_time: number, delta: number) {
      super[$tick](_time, delta);

      if (this[$paused] ||
          (!this[$getModelIsVisible]() && !this[$renderer].isPresenting)) {
        return;
      }

      this[$scene].updateAnimation(delta / MILLISECONDS_PER_SECOND);

      this[$needsRender]();
    }

    updated(changedProperties: Map<string, any>) {
      super.updated(changedProperties);

      if (changedProperties.has('autoplay') && this.autoplay) {
        this.play();
      }

      if (changedProperties.has('animationName')) {
        this[$changeAnimation]();
      }
    }

    [$changeAnimation](options: PlayAnimationOptions = DEFAULT_PLAY_OPTIONS) {
      const repetitions = options.repetitions ?? Infinity;
      const mode = options.pingpong ?
          LoopPingPong :
          (repetitions === 1 ? LoopOnce : LoopRepeat);
      this[$scene].playAnimation(
          this.animationName,
          this.animationCrossfadeDuration / MILLISECONDS_PER_SECOND,
          mode,
          repetitions);

      // If we are currently paused, we need to force a render so that
      // the scene updates to the first frame of the new animation
      if (this[$paused]) {
        this[$scene].updateAnimation(0);
        this[$needsRender]();
      }
    }
  }

  return AnimationModelViewerElement;
};

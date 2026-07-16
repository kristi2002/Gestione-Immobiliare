import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { ContactShadows, Sparkles } from '@react-three/drei';
import * as THREE from 'three';
import { DOOR_HEIGHT_Y, HOUSE_FRONT_Z } from './cameraPath';

/**
 * Placeholder beach-house environment built from primitives, styled for a
 * warm "golden hour" luxury mood. Everything lives under one group so the
 * whole set can be swapped for a GLTF in one place:
 *
 *   const { scene } = useGLTF('/models/beach-house.glb');
 *   return <primitive object={scene} />;
 *
 * Keep the front door centered on x=0 at z=HOUSE_FRONT_Z so the camera path
 * in cameraPath.ts still lines up.
 */

const SAND = '#e8d5b0';
const PLASTER = '#f5efe4';
const ROOF = '#b0715a';
const WOOD = '#8a6748';
const SEA = '#2e7f9e';
const SEA_FOAM = '#bfe8ee';

function House() {
  return (
    <group>
      {/* Main body — door opening is faked by two wall segments + lintel so
          the camera can genuinely pass through the gap. */}
      <mesh position={[-1.55, 1.5, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.1, 3, 4.4]} />
        <meshStandardMaterial color={PLASTER} roughness={0.9} />
      </mesh>
      <mesh position={[1.55, 1.5, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.1, 3, 4.4]} />
        <meshStandardMaterial color={PLASTER} roughness={0.9} />
      </mesh>
      {/* Lintel above the door gap */}
      <mesh position={[0, 2.75, 0]} castShadow>
        <boxGeometry args={[1, 0.5, 4.4]} />
        <meshStandardMaterial color={PLASTER} roughness={0.9} />
      </mesh>
      {/* Back wall closing the gap behind the doorway */}
      <mesh position={[0, 1.5, -1.9]}>
        <boxGeometry args={[1, 3, 0.6]} />
        <meshStandardMaterial color="#d9cdb8" roughness={1} />
      </mesh>

      {/* Door frame */}
      <group position={[0, 0, HOUSE_FRONT_Z]}>
        <mesh position={[-0.55, 1.25, 0]} castShadow>
          <boxGeometry args={[0.12, 2.5, 0.18]} />
          <meshStandardMaterial color={WOOD} roughness={0.6} />
        </mesh>
        <mesh position={[0.55, 1.25, 0]} castShadow>
          <boxGeometry args={[0.12, 2.5, 0.18]} />
          <meshStandardMaterial color={WOOD} roughness={0.6} />
        </mesh>
        <mesh position={[0, 2.52, 0]} castShadow>
          <boxGeometry args={[1.22, 0.12, 0.18]} />
          <meshStandardMaterial color={WOOD} roughness={0.6} />
        </mesh>
      </group>

      {/* Warm interior glow visible through the open door */}
      <mesh position={[0, DOOR_HEIGHT_Y, 0.4]}>
        <planeGeometry args={[0.95, 2.3]} />
        <meshBasicMaterial color="#ffd9a0" toneMapped={false} />
      </mesh>
      <pointLight position={[0, 2, 0.8]} intensity={6} color="#ffb870" distance={7} decay={2} />

      {/* Roof */}
      <mesh position={[0, 3.55, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
        <coneGeometry args={[3.9, 1.6, 4]} />
        <meshStandardMaterial color={ROOF} roughness={0.8} flatShading />
      </mesh>

      {/* Windows on the side the camera sees first */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[2.61, 1.7, s * 1.3]} rotation={[0, Math.PI / 2, 0]}>
          <planeGeometry args={[0.9, 1.1]} />
          <meshStandardMaterial
            color="#ffe3b3"
            emissive="#ffb870"
            emissiveIntensity={0.8}
            roughness={0.2}
          />
        </mesh>
      ))}

      {/* Porch slab + steps toward the beach */}
      <mesh position={[0, 0.06, HOUSE_FRONT_Z + 0.8]} receiveShadow>
        <boxGeometry args={[3.4, 0.14, 1.8]} />
        <meshStandardMaterial color="#d8c9a8" roughness={0.95} />
      </mesh>
    </group>
  );
}

function Water() {
  const surface = useRef<THREE.Mesh>(null);
  const foam = useRef<THREE.Mesh>(null);

  // Gentle physical bob + shoreline drift, delta-time driven via the clock.
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (surface.current) {
      surface.current.position.y = -0.28 + Math.sin(t * 0.5) * 0.045;
    }
    if (foam.current) {
      foam.current.position.z = 14.5 + Math.sin(t * 0.35) * 1.1;
      const mat = foam.current.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.35 + Math.sin(t * 0.35) * 0.15;
    }
  });

  return (
    <group>
      <mesh ref={surface} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.28, 40]}>
        <planeGeometry args={[220, 120, 1, 1]} />
        <meshStandardMaterial
          color={SEA}
          roughness={0.15}
          metalness={0.35}
          transparent
          opacity={0.92}
        />
      </mesh>
      {/* Foam line where the sea meets the sand */}
      <mesh ref={foam} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.22, 14.5]}>
        <planeGeometry args={[220, 3.5]} />
        <meshBasicMaterial color={SEA_FOAM} transparent opacity={0.4} depthWrite={false} />
      </mesh>
    </group>
  );
}

function Terrain() {
  return (
    <group>
      {/* Sand, sloping subtly toward the water */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[220, 60]} />
        <meshStandardMaterial color={SAND} roughness={1} />
      </mesh>
      {/* A few dune mounds for silhouette interest */}
      {(
        [
          [-9, 0, 6, 2.6],
          [11, 0, 4, 3.2],
          [-14, 0, -4, 4],
        ] as const
      ).map(([x, y, z, r], i) => (
        <mesh key={i} position={[x, y - r * 0.75, z]} receiveShadow>
          <sphereGeometry args={[r, 24, 16]} />
          <meshStandardMaterial color="#ddc9a1" roughness={1} />
        </mesh>
      ))}
      {/* Palm-ish accents: trunk + canopy */}
      {(
        [
          [-6.5, 5],
          [7.5, 6.5],
        ] as const
      ).map(([x, z], i) => (
        <group key={i} position={[x, 0, z]}>
          <mesh position={[0, 1.6, 0]} castShadow>
            <cylinderGeometry args={[0.09, 0.16, 3.2, 8]} />
            <meshStandardMaterial color="#7a5c3e" roughness={1} />
          </mesh>
          <mesh position={[0, 3.3, 0]} castShadow>
            <icosahedronGeometry args={[0.9, 0]} />
            <meshStandardMaterial color="#4d7c4a" roughness={0.9} flatShading />
          </mesh>
        </group>
      ))}
    </group>
  );
}

export function HouseScene() {
  // Golden-hour gradient sky as a huge inverted sphere — cheap, no HDR fetch.
  const skyMaterial = useMemo(() => {
    const uniforms = {
      topColor: { value: new THREE.Color('#7ab3d4') },
      horizonColor: { value: new THREE.Color('#ffd9ae') },
    };
    return new THREE.ShaderMaterial({
      uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 topColor;
        uniform vec3 horizonColor;
        varying vec3 vWorld;
        void main() {
          float h = clamp(normalize(vWorld).y * 1.6 + 0.25, 0.0, 1.0);
          gl_FragColor = vec4(mix(horizonColor, topColor, pow(h, 0.8)), 1.0);
        }
      `,
    });
  }, []);

  return (
    <group>
      <mesh material={skyMaterial}>
        <sphereGeometry args={[160, 32, 16]} />
      </mesh>

      {/* Lighting: low warm sun + cool ambient fill + sky/ground hemisphere */}
      <directionalLight
        position={[30, 14, 24]}
        intensity={2.4}
        color="#ffd2a1"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-25}
        shadow-camera-right={25}
        shadow-camera-top={25}
        shadow-camera-bottom={-25}
      />
      <ambientLight intensity={0.35} color="#bcd6e8" />
      <hemisphereLight args={['#a8c8e0', '#c9a97e', 0.55]} />
      <fog attach="fog" args={['#ecd9bd', 45, 150]} />

      <House />
      <Terrain />
      <Water />

      {/* Drifting golden dust motes for atmosphere */}
      <Sparkles count={60} scale={[30, 8, 24]} position={[0, 4, 6]} size={2.5} speed={0.25} color="#ffe9c4" opacity={0.5} />

      <ContactShadows position={[0, 0.01, 0]} opacity={0.4} scale={22} blur={2.4} far={6} resolution={512} frames={1} />
    </group>
  );
}

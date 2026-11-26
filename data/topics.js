// The study topics. Each card, question and formula belongs to one, by its id prefix.
// `hue` is an OKLCH hue used for the topic's color everywhere in the app.
export const TOPICS = [
  {
    id: 'phys', name: 'Radiation physics', short: 'Physics', hue: 265, icon: '⚛️',
    blurb: 'Atoms, radioactive decay, and how photons and particles interact with matter.',
    outline: [
      'Photoelectric absorption (∝ Z³/E³) dominates at low energy and drives subject contrast; Compton (∝ electron density) dominates in tissue from about 30 keV to 25 MeV; pair production needs at least 1.022 MeV.',
      'Attenuation: I = I₀e<sup>−μx</sup>, HVL = 0.693/μ, mean free path = 1/μ = 1.44 HVL. Polyenergetic beams harden as they go, so HVL₂ > HVL₁.',
      'Decay: A = A₀e<sup>−λt</sup>, λ = 0.693/T½, mean life τ = 1.44 T½. Know transient (Mo-99/Tc-99m) and secular (Sr-90/Y-90) equilibrium.',
      'Charged particles: heavy ones lose energy ∝ z²/v² and stop in a Bragg peak; electrons travel about E/2 cm in water.',
      'Bremsstrahlung yield rises with Z and energy; an x-ray tube turns under 1% of its power into x-rays.',
    ],
  },
  {
    id: 'dosi', name: 'Dosimetry', short: 'Dosimetry', hue: 220, icon: '📏',
    blurb: 'KERMA and dose, cavity theory, TG-51, beam data and detectors.',
    outline: [
      'Kerma is energy transferred; dose is energy absorbed. Under charged-particle equilibrium, D = K<sub>col</sub>; beyond d<sub>max</sub> in a megavoltage beam, D = βK<sub>col</sub> with β just over 1.',
      'Bragg–Gray: D<sub>med</sub> = D<sub>gas</sub> × (S/ρ)<sup>med</sup><sub>gas</sub>, for a cavity too small to disturb the electron fluence. Spencer–Attix adds the delta rays.',
      'TG-51: D = M k<sub>Q</sub> N<sub>D,w</sub><sup>60Co</sup>, M = P<sub>ion</sub>P<sub>TP</sub>P<sub>elec</sub>P<sub>pol</sub>M<sub>raw</sub>. Photon quality is %dd(10)<sub>x</sub>; electron quality is R<sub>50</sub>, with d<sub>ref</sub> = 0.6R<sub>50</sub> − 0.1 cm.',
      'PDD rises with energy, field size and SSD. TMR doesn’t depend on SSD. Equivalent square = 4A/P.',
      'Know each detector’s strengths and dependences: ion chambers, diodes, TLD, OSLD, film, diamond, scintillators.',
    ],
  },
  {
    id: 'rbio', name: 'Radiobiology', short: 'Radiobiology', hue: 330, icon: '🧬',
    blurb: 'Cell survival, the LQ model, fractionation, and radiation effects on people.',
    outline: [
      'LQ model: S = e<sup>−αD−βD²</sup>; BED = nd(1 + d/(α/β)); EQD2 = BED/(1 + 2/(α/β)).',
      'α/β ≈ 10 Gy for tumors and early-responding tissue, ≈ 3 Gy for late-responding tissue, ≈ 1.5 Gy for prostate.',
      'The 5 Rs: repair, redistribution, repopulation, reoxygenation and radiosensitivity. M and G2 are the most sensitive phases; late S the most resistant.',
      'OER ≈ 2.5–3 for x-rays and ≈ 1 for alphas; RBE peaks near an LET of 100 keV/µm.',
      'Deterministic effects have thresholds (cataract 0.5 Gy; skin erythema ≈ 2 Gy); stochastic risk is about 5%/Sv.',
    ],
  },
  {
    id: 'prot', name: 'Radiation protection', short: 'Protection', hue: 25, icon: '🛡️',
    blurb: 'Dose limits, weighting factors, shielding design and the NRC rules.',
    outline: [
      'Effective dose E = Σ w<sub>T</sub>H<sub>T</sub>; H<sub>T</sub> = Σ w<sub>R</sub>D<sub>T,R</sub>. Photons and electrons w<sub>R</sub> = 1, protons 2, alphas 20.',
      'NRC limits: 50 mSv/yr occupational, 150 mSv lens, 500 mSv skin and extremities, 1 mSv/yr public, 5 mSv to the embryo/fetus of a declared pregnant worker.',
      'Shielding: B = Pd²/(WUT), n = log₁₀(1/B) TVLs. Design goals: 0.1 mSv/week controlled, 0.02 mSv/week uncontrolled.',
      'Medical event: delivered dose differs from the written directive by 20% or more (50% for a single fraction). Report to the NRC by the next calendar day.',
      'Time, distance, shielding; justification, optimization, limitation.',
    ],
  },
  {
    id: 'xray', name: 'Radiography, fluoro & CT', short: 'X-ray & CT', hue: 195, icon: '🩻',
    blurb: 'X-ray tubes, detectors, mammography, fluoroscopy and computed tomography.',
    outline: [
      'Output ∝ mAs and roughly kVp²; the 15% rule: +15% kVp ≈ doubling mAs. Effective focal spot = actual × sin(anode angle).',
      'Magnification M = SID/SOD; geometric blur = f(M − 1). Grids trade dose (Bucky factor) for scatter rejection.',
      'Fluoro: 88 mGy/min normal, 176 mGy/min high-level, at the reference point 15 cm toward the tube from isocenter.',
      'CT: HU = 1000(μ − μ<sub>w</sub>)/μ<sub>w</sub>; CTDI<sub>w</sub> = ⅓ center + ⅔ periphery; CTDI<sub>vol</sub> = CTDI<sub>w</sub>/pitch; DLP = CTDI<sub>vol</sub> × length; E ≈ k × DLP.',
      'Mammography: low kVp with Mo, Rh, Ag filters; MQSA limits mean glandular dose to 3 mGy per view.',
    ],
  },
  {
    id: 'imgs', name: 'Imaging science & statistics', short: 'Image science', hue: 160, icon: '📊',
    blurb: 'Resolution, noise, detectability, ROC analysis and counting statistics.',
    outline: [
      'Poisson counting: σ = √N, relative error 1/√N. Errors of sums and differences add in quadrature.',
      'MTF is the Fourier transform of the LSF. DQE = SNR²<sub>out</sub>/SNR²<sub>in</sub>. Nyquist frequency = 1/(2 × pixel pitch).',
      'Rose criterion: an object needs an SNR of about 5 to be seen reliably.',
      'Sensitivity = TP/(TP+FN), specificity = TN/(TN+FP); PPV and NPV depend on prevalence. ROC AUC 0.5 is chance.',
    ],
  },
  {
    id: 'mrus', name: 'MRI & ultrasound', short: 'MRI & US', hue: 290, icon: '🧲',
    blurb: 'Larmor precession, relaxation, pulse sequences, artifacts and safety; sound in tissue and Doppler.',
    outline: [
      'Larmor: f = (γ/2π)B₀, 42.58 MHz/T for ¹H. T1 is regrowth of M<sub>z</sub> (to 63%); T2 is decay of M<sub>xy</sub> (to 37%); T2* adds field inhomogeneity.',
      'T1-weighted: short TR, short TE. T2-weighted: long TR, long TE. PD: long TR, short TE. STIR nulls fat at TI = 0.693 T1.',
      'Scan time = TR × N<sub>phase</sub> × NEX ÷ ETL. SNR ∝ voxel volume × √(N<sub>phase</sub> × NEX / BW).',
      'Ultrasound: c = 1540 m/s in soft tissue (13 µs per cm of depth, round trip), Z = ρc, attenuation ≈ 0.5 dB/cm/MHz, Doppler f<sub>D</sub> = 2f₀v cos θ / c.',
      'Safety: MRI zones I–IV, SAR 2 W/kg whole body (normal mode); ultrasound MI ≤ 1.9 and I<sub>SPTA</sub> ≤ 720 mW/cm².',
    ],
  },
  {
    id: 'nmed', name: 'Nuclear medicine & PET', short: 'Nuc med', hue: 135, icon: '☢️',
    blurb: 'Radionuclides, generators, gamma cameras, SPECT, PET, QC and internal dosimetry.',
    outline: [
      'Tc-99m: 140 keV, 6.0 h, from a Mo-99 (66 h) generator; Mo-99 breakthrough ≤ 0.15 µCi per mCi Tc-99m.',
      'Gamma camera: NaI(Tl), parallel-hole or pinhole collimators; 20% window. QC: daily uniformity and peaking, weekly bar phantom, COR for SPECT.',
      'PET: 511 keV coincidences; trues, scatters and randoms (R = 2τS₁S₂); LYSO enables time of flight.',
      'SUV = tissue concentration ÷ (injected activity / body weight).',
      'MIRD: D = Ã × S; 1/T<sub>eff</sub> = 1/T<sub>p</sub> + 1/T<sub>b</sub>.',
    ],
  },
  {
    id: 'ther', name: 'External beam therapy', short: 'Therapy', hue: 55, icon: '🎯',
    blurb: 'Linacs, treatment planning, electrons, protons, SRS, IGRT and QA.',
    outline: [
      'Linac: magnetron or klystron, standing- or traveling-wave guide, 270° achromatic bending magnet, flattening filter (or FFF), dual monitor chambers, MLC.',
      'ICRU volumes: GTV ⊂ CTV ⊂ ITV ⊂ PTV; report D98, D50 and D2 (ICRU 83).',
      'Electrons: R90 ≈ E/3.2 cm, R80 ≈ E/2.8 cm, Rp ≈ E/2 cm. Protons: RBE 1.1, range margin ≈ 3.5% + 1 mm.',
      'QA: TG-142 (daily output ±3%), TG-218 (gamma 3%/2 mm, 95% tolerance, 90% action), TG-100 (FMEA, RPN = O × S × D).',
      'Wedge angle = 90° − hinge/2. Field gap = ½L₁(d/SSD₁) + ½L₂(d/SSD₂).',
    ],
  },
  {
    id: 'brac', name: 'Brachytherapy', short: 'Brachy', hue: 5, icon: '💠',
    blurb: 'Sources, the TG-43 formalism, implant systems, LDR and HDR.',
    outline: [
      'TG-43: Ḋ(r,θ) = S<sub>K</sub> Λ [G(r,θ)/G(r₀,θ₀)] g(r) F(r,θ), with r₀ = 1 cm, θ₀ = 90°.',
      'Sources: Ir-192 (73.8 d, ≈ 380 keV), I-125 (59.4 d, ≈ 28 keV), Pd-103 (17.0 d, ≈ 21 keV), Cs-137 (30.1 y, 662 keV), Co-60 (5.27 y, 1.25 MeV).',
      'Permanent implant: total dose = 1.44 Ḋ₀ T½. Prostate monotherapy: 145 Gy with I-125, 125 Gy with Pd-103.',
      'Cervix: Point A is 2 cm superior and 2 cm lateral; image-guided plans report HR-CTV D90 and OAR D2cc.',
      'Implant systems: Manchester (Paterson–Parker), Quimby, Paris (reference dose = 85% of basal dose).',
    ],
  },
];

export const TOPIC_BY_ID = Object.fromEntries(TOPICS.map((t) => [t.id, t]));

/** The topic id a card, question or formula belongs to, from its id prefix. */
export const topicOf = (id) => id.slice(0, 4);

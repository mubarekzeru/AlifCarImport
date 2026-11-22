import type { ShowroomStore } from '../types/showroom';

const BASE_URL =
  typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL
    ? import.meta.env.BASE_URL
    : '/';

export const ALIF_DEFAULT_LOGO = `${BASE_URL}assets/aistudio/file_00000000f2b48211a1d7ce760b266f14_d8a15dfc.png`;
export const ALIF_DEFAULT_HERO_VIDEO = `${BASE_URL}assets/aistudio/Alif_Car_Import_Premium_Vehicles_b269f200.mp4`;
export const ALIF_DEFAULT_HERO_POSTER = `${BASE_URL}assets/aistudio/hero-video-poster.jpg`;

export const INITIAL_SHOWROOM_STORE: ShowroomStore = {
  branding: {
    companyName: 'Alif Car Import',
    logoUrl: ALIF_DEFAULT_LOGO,
    tagline: 'Direct Global Vehicle Imports',
  },
  hero: {
    kicker: 'Premium Automotive Import',
    title: 'Drive Your Dreams',
    description:
      'Premium vehicles curated for the discerning driver — sourced, inspected, and delivered with full customs transparency.',
    imageUrl: '',
    videoUrl: ALIF_DEFAULT_HERO_VIDEO,
    ctaLabel: 'Explore Collection',
  },
  vehicles: [],
  tiktok: {
    title: 'Walkaround Reels on TikTok',
    description:
      'Watch real-time port arrivals, interior walkarounds, and cold-start inspections posted directly from our showroom floor.',
    profileUrl: 'https://www.tiktok.com/@alif.car1',
    handle: '@alif.car1',
    posts: [],
  },
  contact: {
    addressLine: 'Meskel Flower Dreamliner Hotel, Infront of Zemen Bank',
    cityCountry: 'Addis Ababa, Ethiopia',
    hours: 'Mon – Sat: 8:30 AM – 6:30 PM',
    phone: '+251976011111',
    whatsapp: '+251976011111',
    telegram: 'Alif_Car_Import',
    instagram: '@alif_car_import',
    facebook: '',
    x: '',
    email: 'info@alifcar.com',
    mapsUrl: 'https://maps.google.com/?q=Meskel+Flower+Dreamliner+Hotel+Addis+Ababa',
    landmarkNote: 'Infront of Zemen Bank, Meskel Flower',
  },
  adminEmails: ['alifcarimports@gmail.com'],
};

# watermrk

## Cara running dilocal docker

``` cmd
    docker compose down
    docker compose build --no-cache
    docker compose up -d
```

## Letak watermark

| Gravity     | Posisi       |
| ----------- | ------------ |
| `northwest` | Kiri atas    |
| `north`     | Tengah atas  |
| `northeast` | Kanan atas   |
| `west`      | Tengah kiri  |
| `center`    | Tengah       |
| `east`      | Tengah kanan |
| `southwest` | Kiri bawah   |
| `south`     | Tengah bawah |
| `southeast` | Kanan bawah  |

## Cara Penggunaan

POST : http://{IP}:3021/watermark

```json
params : {
    photo: FILE,
    gravity: 'northwest',
    max_size: 500 //kb
    address: 'dada',
    lat: 0.2,
    lng: 12.23,
    apps: TIP SISWA
} 
```
